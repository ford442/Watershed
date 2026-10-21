/**
 * sweHost — the field half of WaterForceSystem (#467 split).
 *
 * Owns what happens to the player-centred SWE window each frame, on whichever
 * backend steps it (sim worker, main-thread WASM, or the WGSL twin):
 *
 * - The window follows the vehicle on the world's cell lattice; every
 *   whole-cell move scrolls h/u/w/b with the world first (sweScroll.ts / swe.h),
 *   so a splash stays where it landed instead of riding the camera.
 * - The canyon floor is re-rasterized into `b` when the window or the treadmill
 *   moves (refreshBed), then committed to the stepper.
 * - The upstream (+Z) edge takes the launch-hour discharge routed down the
 *   campaign chain (riverRouter.ts → emscripten/routing.cpp); entering cells and
 *   a freshly placed window take the same routed state. On `wasm-worker` the
 *   router lives in the sim worker and only the chain index travels per step.
 * - Steps at the budget's rate with disturbances and authored hydro events, and
 *   uploads the height + surface textures FlowingWater displaces by.
 *
 * Forces are the other half: waterForceBridge.ts.
 */

import * as THREE from 'three';
import type { WatershedNativeModule } from './wasmAbi';
import type { SweEventCall, SweSim, SweStepInput } from './sweSim';
import type { SimWorkerProxy } from '../../sim/createSimWorkerProxy';
import { isWorkerSweSim, type WorkerSweSim } from '../../sim/workerSweSim';
import {
  SWE_MEAN_DEPTH,
  consumeSWEDisturbances,
  updateSWEHeightFieldSnapshot,
} from './SWEHeightField';
import { sweStepInterval, type SWEBudget } from './sweQuality';
import { SWE_REST_INFLOW, advanceSweWindow, type SweInflow, type SweWindow } from './sweScroll';
import {
  createRiverRouter,
  routedEdgeInflow,
  type RiverRouter,
  type RouterWeather,
  type RoutingForecast,
} from './riverRouter';
import { getRoutingReach, routingChainIndex, type RoutingReach } from '../map/routingReach';
import { DEFAULT_FORECAST_INPUTS } from '../../constants/forecast';
import {
  getBathymetryRevision,
  getRegisteredBathymetryCount,
  getRegisteredBathymetrySource,
  sampleBathymetryInto,
} from './bathymetrySampler';
import { publishSWEBedSnapshot } from './sweBedDebug';
import { useGameStore } from '../GameState';
import { runHeightfieldChores } from '../../rendering/gpuChores';
import type { SWEFlowGrid } from './sampleSWEFlow';
import { packSweSurfaceField } from './sweSurfaceField';
import { GRAVITY } from '../../constants/game';
import { applyHydroEventsToGrid, parseHydroEvents } from './hydroEvents';
import { ACTIVE_MAP_ID } from '../../maps/registry';
import {
  getActiveConditions,
  getActiveLaunchHour,
  getActiveWeather,
  getRunMap,
  getRunSession,
} from '../journey/runSession';
import { getDirectorOverChainIndex } from '../weather/weatherDirector';
import { launchWeatherOf } from '../weather/weatherScript';

function worldToGridIndex(
  worldX: number,
  worldZ: number,
  originX: number,
  originZ: number,
  budget: SWEBudget,
): { gx: number; gz: number } | null {
  const gx = Math.round((worldX - originX) / budget.cellSize);
  const gz = Math.round((worldZ - originZ) / budget.cellSize);
  if (gx < 0 || gx >= budget.width || gz < 0 || gz >= budget.height) return null;
  return { gx, gz };
}

export function toFlowGrid(
  grid: SweSim,
  originX: number,
  originZ: number,
): SWEFlowGrid {
  return {
    h: grid.h,
    u: grid.u,
    w: grid.w,
    b: grid.b,
    width: grid.width,
    height: grid.height,
    cellSize: grid.dx,
    originX,
    originZ,
  };
}

function applyDisturbances(
  grid: SweSim,
  originX: number,
  originZ: number,
  disturbances: ReturnType<typeof consumeSWEDisturbances>,
  budget: SWEBudget,
): void {
  for (const d of disturbances) {
    const center = worldToGridIndex(d.worldX, d.worldZ, originX, originZ, budget);
    if (!center) continue;

    const radiusCells = Math.max(1, Math.ceil(d.radius / budget.cellSize));
    for (let dz = -radiusCells; dz <= radiusCells; dz += 1) {
      for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
        const gx = center.gx + dx;
        const gz = center.gz + dz;
        if (gx < 0 || gx >= grid.width || gz < 0 || gz >= grid.height) continue;
        const dist = Math.hypot(dx, dz) * budget.cellSize;
        if (dist > d.radius) continue;
        const falloff = Math.exp(-(dist * dist) / Math.max(d.radius * d.radius, 0.01));
        const idx = gz * grid.width + gx;
        grid.addSurface(idx, d.amplitude * falloff);
      }
    }
  }
}

function uploadHeightTexture(
  grid: SweSim,
  texture: THREE.DataTexture,
  flowTexture: THREE.DataTexture,
  originX: number,
  originZ: number,
  budget: SWEBudget,
): void {
  (texture.image.data as unknown as Float32Array).set(grid.h);
  texture.needsUpdate = true;
  // Same fieldVersion, same origin: the surface reads (u, w, depth, div) from the CPU
  // mirror (WASM heap view or the WGSL readback mirror — never the compute buffer).
  packSweSurfaceField(grid, flowTexture.image.data as unknown as Float32Array, SWE_MEAN_DEPTH);
  flowTexture.needsUpdate = true;
  updateSWEHeightFieldSnapshot({
    texture,
    flowTexture,
    originX,
    originZ,
    cellSize: budget.cellSize,
    width: budget.width,
    height: budget.height,
    displacementScale: budget.displacementScale,
    enabled: true,
  });
}

export interface BedState {
  valid: boolean;
  revision: number;
  originX: number;
  originZ: number;
}

/**
 * Re-rasterize the canyon floor into `grid.b` when the sampling window has
 * moved a whole cell or the treadmill has swapped segments. Every cell is
 * rewritten, so a recycled slot cannot leak its predecessor's bed. The frame
 * scrolls the field first, so this overwrites a bed that is already in the new
 * index frame, with the world-correct floor.
 */
function refreshBed(
  grid: SweSim,
  originX: number,
  originZ: number,
  budget: SWEBudget,
  state: BedState,
): void {
  const revision = getBathymetryRevision();
  // The window only ever moves by whole cells (advanceSweWindow), so half a cell
  // is a threshold no rounding can miss — a scroll always re-rasterizes.
  const moved =
    Math.abs(originX - state.originX) >= budget.cellSize * 0.5 ||
    Math.abs(originZ - state.originZ) >= budget.cellSize * 0.5;
  if (state.valid && revision === state.revision && !moved) return;

  const covered = sampleBathymetryInto(
    grid.b,
    originX,
    originZ,
    budget.cellSize,
    grid.width,
    grid.height,
  );
  grid.commitBed();

  state.valid = true;
  state.revision = revision;
  state.originX = originX;
  state.originZ = originZ;

  publishSWEBedSnapshot({
    bed: grid.b,
    width: grid.width,
    height: grid.height,
    cellSize: budget.cellSize,
    originX,
    originZ,
    coveredCells: covered,
    sourceCount: getRegisteredBathymetryCount(),
  });
}

export interface RouterState {
  router: RiverRouter | null;
  /** The run (`runId`) the router was spun up for; a new run (or hour) re-routes from launch. */
  session: number | null;
  launchHour: number;
}

/**
 * The router for the current run, rebuilt when the run or its launch hour
 * changes. Null without the ABI-10 exports — the window then steps with every
 * edge transmissive, exactly as before routing.
 */
function currentRouter(wasm: WatershedNativeModule | null, state: RouterState): RiverRouter | null {
  if (!wasm) return null;
  const session = getRunSession()?.runId ?? null;
  const launchHour = getActiveLaunchHour();
  if (state.router && state.session === session && state.launchHour === launchHour) return state.router;
  state.router?.dispose();
  state.router = createRiverRouter(wasm, getRoutingReach(), launchHour, { forecast: runRoutingForecast() });
  state.session = session;
  state.launchHour = launchHour;
  return state.router;
}

/**
 * The forecast the run's router spins up on: the day's melt inputs and the
 * weather at launch (script step 0). Later steps arrive per step (setWeather).
 */
function runRoutingForecast(): RoutingForecast {
  const { temperature, snowpackIndex, weatherScript } = getActiveConditions();
  return { ...DEFAULT_FORECAST_INPUTS, temperature, snowpackIndex, weather: launchWeatherOf(weatherScript) };
}

/** The river weather this step routes: the WeatherDirector's, as a fresh value for the worker message. */
function routerWeatherNow(): RouterWeather {
  const weather = getActiveWeather();
  return { type: weather.type, intensity: weather.intensity, overChainIndex: getDirectorOverChainIndex() };
}

/** The player's position on the routed chain, or null off it. */
function playerChainIndex(reach: RoutingReach): number | null {
  const mapId = getRunSession()?.mapId ?? ACTIVE_MAP_ID;
  return routingChainIndex(reach, mapId, useGameStore.getState().currentSegmentIndex);
}

/** Routed state for the player's segment, as the (η, u, w) an entering cell takes. */
function routedInflow(router: RiverRouter | null): { edgeEta: number; inflow: SweInflow } | null {
  if (!router) return null;
  return routedEdgeInflow(router, playerChainIndex(router.reach), SWE_MEAN_DEPTH, GRAVITY);
}

export interface WorkerRouterState {
  /** Proxy the router was sent to; a different one (never, today) re-sends. */
  proxy: SimWorkerProxy | null;
  session: number | null;
  launchHour: number;
  reach: RoutingReach | null;
}

/**
 * `currentRouter` for the `wasm-worker` backend: the router lives in the sim
 * worker. (Re)send it when the run or its launch hour changes — the same
 * trigger, at the same point in the frame, as the main-thread rebuild — and
 * return the chain index the frame's SCROLL / STEP carry. No native call here.
 */
function syncWorkerRouter(grid: WorkerSweSim, state: WorkerRouterState): number | null {
  const session = getRunSession()?.runId ?? null;
  const launchHour = getActiveLaunchHour();
  if (state.proxy !== grid.proxy || state.session !== session || state.launchHour !== launchHour || !state.reach) {
    const reach = getRoutingReach();
    grid.proxy.post({
      type: 'ROUTER',
      reach,
      launchHour,
      forecast: runRoutingForecast(),
      H: SWE_MEAN_DEPTH,
      g: GRAVITY,
    });
    state.proxy = grid.proxy;
    state.session = session;
    state.launchHour = launchHour;
    state.reach = reach;
  }
  return playerChainIndex(state.reach);
}

/** Everything the field keeps between frames; the component holds one per mount. */
export interface SweHostState {
  grid: SweSim | null;
  texture: THREE.DataTexture | null;
  flowTexture: THREE.DataTexture | null;
  /** Where the live grid's window sits on the world's cell lattice; null until the first frame after a (re)build. */
  window: SweWindow | null;
  stepAccumulator: number;
  uploadedVersion: number;
  /** Bed refresh bookkeeping: re-rasterize only when the window slides a cell or the treadmill changes. */
  bed: BedState;
  router: RouterState;
  workerRouter: WorkerRouterState;
}

export function createSweHostState(): SweHostState {
  return {
    grid: null,
    texture: null,
    flowTexture: null,
    window: null,
    stepAccumulator: 0,
    uploadedVersion: -1,
    bed: { valid: false, revision: -1, originX: 0, originZ: 0 },
    router: { router: null, session: null, launchHour: Number.NaN },
    workerRouter: { proxy: null, session: null, launchHour: Number.NaN, reach: null },
  };
}

/** A freshly installed grid starts on a new window, an empty bed and no upload. */
export function resetSweHostForGrid(state: SweHostState): void {
  state.stepAccumulator = 0;
  state.uploadedVersion = -1;
  state.bed = { valid: false, revision: -1, originX: 0, originZ: 0 };
  state.window = null;
}

/** Drop the router(s) when the system unmounts. */
export function disposeSweHostRouters(state: SweHostState): void {
  state.router.router?.dispose();
  state.router = { router: null, session: null, launchHour: Number.NaN };
  state.workerRouter.proxy?.post({ type: 'DISPOSE_ROUTER' });
  state.workerRouter = { proxy: null, session: null, launchHour: Number.NaN, reach: null };
}

/**
 * One frame of the field: place the window on the vehicle, scroll, refresh the
 * bed, step at the budget's rate, upload. Returns the window origin every
 * consumer reads this frame (never the raw anchor) and whether SWE is live.
 * `wasm` is the main-thread module (null on sim-worker / WGSL boots).
 */
export function sweHostFrame(
  state: SweHostState,
  budget: SWEBudget,
  wasm: WatershedNativeModule | null,
  anchor: { x: number; z: number },
  dt: number,
): { originX: number; originZ: number; sweEnabled: boolean } {
  // The window centres on the vehicle but sits on the world's cell lattice,
  // moving only by whole cells: a cell keeps its world position while it
  // survives. Every consumer below reads this origin, never the raw anchor.
  const advance = advanceSweWindow(state.window, anchor.x, anchor.z, budget);
  const sweWindow = advance?.window ?? state.window;
  const originX = sweWindow?.originX ?? anchor.x - (budget.width * budget.cellSize) * 0.5;
  const originZ = sweWindow?.originZ ?? anchor.z - (budget.height * budget.cellSize) * 0.5;

  const { grid, texture, flowTexture } = state;
  if (budget.enabled && grid && texture && flowTexture) {
    // Carry the previous step's field into the new window's index frame BEFORE
    // the bed is rewritten and the solver runs. The solver is origin-blind and
    // the rasterizer only rewrites `b`, so without this h/u/w would stay in
    // their old slots while the canyon moved underneath them. A jump larger
    // than the grid (respawn) saturates: the field restarts at the routed
    // state. Entering cells take the routed river, not still water.
    //
    // On wasm-worker the router is the worker's: the chain index rides on the
    // SCROLL / STEP and the worker derives the same edge the branch below does.
    const remote = isWorkerSweSim(grid) ? grid : null;
    const chainIndex = remote ? syncWorkerRouter(remote, state.workerRouter) : null;
    const router = remote ? null : currentRouter(wasm, state.router);
    const routed = remote ? null : routedInflow(router);
    const fill = routed?.inflow ?? SWE_REST_INFLOW;
    if (advance) {
      if (remote) {
        const route = { chainIndex };
        if (state.window === null) {
          remote.scrollRouted(grid.width, 0, route, true, originX, originZ);
        } else if (advance.shiftX !== 0 || advance.shiftZ !== 0) {
          remote.scrollRouted(advance.shiftX, advance.shiftZ, route, false, originX, originZ);
        }
      } else if (state.window === null && routed) {
        // A fresh window starts as the river it sits in, so the routed stage
        // does not have to bore in from the edge on every rebuild.
        grid.scroll(grid.width, 0, fill);
      } else if (advance.shiftX !== 0 || advance.shiftZ !== 0) {
        grid.scroll(advance.shiftX, advance.shiftZ, fill);
      }
      state.window = advance.window;
    }
    remote?.setOrigin(originX, originZ);

    refreshBed(grid, originX, originZ, budget, state.bed);

    // Step-rate budget: accumulate render deltas and take one SWE step per
    // budgeted interval, so a 30Hz preset costs half a 60Hz preset's steps.
    const interval = sweStepInterval(budget);
    state.stepAccumulator += dt;
    if (state.stepAccumulator >= interval) {
      const stepDt = Math.min(state.stepAccumulator, 0.05);
      state.stepAccumulator = 0;
      // The director's weather for this step, then the advance (the worker does the same).
      const weather = routerWeatherNow();
      router?.setWeather(weather);
      router?.advance(stepDt);

      applyDisturbances(grid, originX, originZ, consumeSWEDisturbances(), budget);

      // Authored hydro events run after the step, through the same backend.
      const hydroEvents = parseHydroEvents(getRunMap().levelData.hydroEvents);
      const eventCalls: SweEventCall[] = [];
      applyHydroEventsToGrid(
        {
          h: grid.h,
          u: grid.u,
          w: grid.w,
          b: grid.b,
          width: grid.width,
          height: grid.height,
          cellSize: grid.dx,
          originX,
          originZ,
          stillDepth: SWE_MEAN_DEPTH,
        },
        hydroEvents,
        getActiveLaunchHour(),
        (event) => {
          const source = getRegisteredBathymetrySource(event.segmentIndex);
          if (!source) return null;
          return { x: source.centerX, z: source.centerZ };
        },
        stepDt,
        (kind, cx, cz, radius, strength, dtEvent) => {
          eventCalls.push({ kind, cx, cz, radius, strength, dt: dtEvent });
        },
      );

      // Bed sampled from the canyon floor by refreshBed() above (#374
      // Phase 2). Uncovered cells read as dry land, not open water.
      const stepInput: SweStepInput = {
        dt: stepDt,
        g: GRAVITY,
        H: SWE_MEAN_DEPTH,
        originX,
        originZ,
        events: eventCalls,
        // Upstream edge = the routed discharge at the player's segment; the
        // hull reads it back through sampleSWEFlow like any other η.
        edgeEta: routed?.edgeEta,
      };
      if (remote) remote.stepRouted(stepInput, { chainIndex, weather });
      else grid.step(stepInput);
    }
    // WASM bumps fieldVersion inside step(); WGSL when its readback lands.
    if (grid.fieldVersion !== state.uploadedVersion) {
      state.uploadedVersion = grid.fieldVersion;
      uploadHeightTexture(grid, texture, flowTexture, originX, originZ, budget);
      runHeightfieldChores(grid.h, grid.width, grid.height);
    } else {
      // Grid didn't step, but the player moved — keep the sampling window
      // anchored so the displacement doesn't lag behind the camera.
      updateSWEHeightFieldSnapshot({ originX, originZ });
    }
  }

  return { originX, originZ, sweEnabled: Boolean(budget.enabled && grid) };
}
