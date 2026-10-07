/**
 * WaterForceSystem — production WASM water coupling.
 *
 * - Steps a player-centered SWE grid and uploads height data for FlowingWater.
 *   The solver runs in the sim worker by default (src/sim/, #455); this file
 *   still clocks it — same dt and events on every backend — and reads the field
 *   back through the SweSim mirror.
 *   The grid is a window that follows the vehicle; every whole-cell move of its
 *   origin scrolls h/u/w/b with the world first (sweScroll.ts / swe.h), so a
 *   splash stays where it landed instead of riding the camera.
 * - Drives the window's upstream (+Z) edge with the launch-hour discharge,
 *   routed down the campaign chain (riverRouter.ts → emscripten/routing.cpp).
 *   Cells entering the window, and a freshly placed window, take the same
 *   routed state, so a 14:00 river is higher everywhere in the window, not just
 *   along one edge. On `wasm-worker` the router lives in the sim worker (#455
 *   Phase B): this file sends the run / hour once and the chain index per step.
 * - Applies native buoyancy + current drag to the vehicle and floating debris
 *   using SWE-sampled flowDir / speed (sampleSWEFlow → calculateWaterForce).
 *   On `wasm-worker` both run in the sim worker on the stepped field
 *   (simForces.ts); results land a frame later and are applied then. The
 *   Rapier worker's raft gets its force from the sim worker directly
 *   (hullLinkProtocol.ts), so this file only posts the authored tick params.
 * - Falls back to pure TypeScript force math when WASM is unavailable, and when
 *   the sim worker dies mid-session (with SWE off).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WATER_LEVEL } from '../../constants/game';
import { FLOATING_OBJECT } from '../../constants/game';
import { WATER_PHYSICS } from '../../vehicles/RaftVehicle/constants';
import {
  calculateWaterForceFallback,
  getWasm,
  type NativeWaterForceConfig,
  type WatershedNativeModule,
} from './WatershedWasm';
import { createWasmSweSim, type SweEventCall, type SweSim, type SweStepInput } from './sweSim';
import { createWgslSweSim } from './WgslSweSim';
import {
  demoteSweSimBackendToWasm,
  demoteSweSimBackendToWasmMain,
  resolveSweSimBackendDecision,
} from './sweBackend';
import { getSimWorkerProxy, type SimWorkerProxy } from '../../sim/createSimWorkerProxy';
import { createWorkerSweSim, isWorkerSweSim, type WorkerSweSim } from '../../sim/workerSweSim';
import {
  FORCE_SAMPLE_STRIDE,
  readForceFlow,
  readForceResult,
  writeForceSample,
} from '../../sim/simForces';
import { createSimForceRequests, type SimForceRequests } from '../../sim/simForceRequests';
import { getSessionGpuDevice } from '../../rendering/gpuChores/device';
import {
  SWE_MEAN_DEPTH,
  consumeSWEDisturbances,
  setSWEActiveBudget,
  updateSWEHeightFieldSnapshot,
  clearSWEHeightField,
} from './SWEHeightField';
import { sweBudgetForQuality, sweStepInterval, type SWEBudget } from './sweQuality';
import { SWE_REST_INFLOW, advanceSweWindow, type SweInflow, type SweWindow } from './sweScroll';
import { createRiverRouter, routedEdgeInflow, type RiverRouter } from './riverRouter';
import { getRoutingReach, routingChainIndex, type RoutingReach } from '../map/routingReach';
import { DEFAULT_FORECAST_INPUTS } from '../../constants/forecast';
import {
  getBathymetryRevision,
  getRegisteredBathymetryCount,
  getRegisteredBathymetrySource,
  sampleBathymetryInto,
} from './bathymetrySampler';
import { publishSWEBedSnapshot, clearSWEBedSnapshot } from './sweBedDebug';
import { useGameStore, useQualityPreset } from '../GameState';
import {
  collectWaterForceBodies,
  registerVehicleWaterBody,
  setWaterForceSystemActive,
  type WaterForceBody,
} from './WaterForceRegistry';
import {
  getPhysicsWorkerDiagnostics,
  isPhysicsWorkerActive,
  setPhysicsWorkerTickParams,
  setSWEStatus,
} from '../../physics/physicsWorkerRegistry';
import { bindChoreWasm, bindHeightfieldChoreWorker, runHeightfieldChores } from '../../rendering/gpuChores';
import {
  sampleSWEFlow,
  FALLBACK_FLOW_DIR,
  SWE_STAGE_SPEED_BOOST,
  MAX_STAGE_OFFSET,
  stagedWaterLevel,
  type SWEFlowGrid,
  type SWEFlowSample,
} from './sampleSWEFlow';
import { packSweSurfaceField, SWE_FLOW_CHANNELS } from './sweSurfaceField';
import { applyHydroEventsToGrid, parseHydroEvents } from './hydroEvents';
import { ACTIVE_MAP_ID, getActiveMap } from '../../maps/registry';
import { getActiveLaunchHour, getActiveWeather, getRunSession } from '../journey/runSession';
import { weatherHullScale } from '../map/weatherInflow';
import { shouldSkipMainThreadVehicleForce } from '../../physics/waterForceAuthority';
import type { VehicleRigidBodyRef, VehicleType } from '../../experience/types';

const PHYSICS_SCALE = 0.001;
const GRAVITY = 9.80665;

interface WaterForceSystemProps {
  vehicleRef: React.RefObject<VehicleRigidBodyRef | null>;
  vehicleType?: VehicleType;
  flowSpeed?: number;
  waterLevel?: number;
  turbulenceStrength?: number;
  turbulenceFrequency?: number;
}

function vehicleForceConfig(
  vehicleType: VehicleType,
  flowSpeed: number,
  waterLevel: number,
  timeSeconds: number,
  turbulenceStrength: number,
  turbulenceFrequency: number,
  dragScale = 1,
): NativeWaterForceConfig {
  if (vehicleType === 'raft') {
    return {
      flowSpeed,
      waterLevel,
      raftMass: WATER_PHYSICS.RAFT_MASS,
      raftVolume: WATER_PHYSICS.RAFT_VOLUME,
      dragCoefficient: WATER_PHYSICS.DRAG_COEFFICIENT * dragScale,
      frontalArea: WATER_PHYSICS.RAFT_WIDTH * WATER_PHYSICS.RAFT_HEIGHT,
      sideArea: WATER_PHYSICS.RAFT_LENGTH * WATER_PHYSICS.RAFT_HEIGHT,
      timeSeconds,
      turbulenceStrength,
      turbulenceFrequency,
    };
  }

  return {
    flowSpeed,
    waterLevel,
    raftMass: 82,
    raftVolume: 0.08,
    dragCoefficient: dragScale,
    frontalArea: 0.45,
    sideArea: 0.35,
    timeSeconds,
    turbulenceStrength: turbulenceStrength * 0.75,
    turbulenceFrequency,
  };
}

function floatingForceConfig(
  flowSpeed: number,
  waterLevel: number,
  timeSeconds: number,
  body: WaterForceBody,
  turbulenceStrength: number,
  turbulenceFrequency: number,
  dragScale = 1,
): NativeWaterForceConfig {
  return {
    flowSpeed: flowSpeed * FLOATING_OBJECT.FLOW_INFLUENCE,
    waterLevel,
    raftMass: (body.mass ?? FLOATING_OBJECT.DEBRIS_DENSITY * FLOATING_OBJECT.DEBRIS_VOLUME) * PHYSICS_SCALE,
    raftVolume: body.volume ?? FLOATING_OBJECT.DEBRIS_VOLUME,
    dragCoefficient: (body.dragCoefficient ?? FLOATING_OBJECT.DRAG_COEFFICIENT) * dragScale,
    frontalArea: body.frontalArea ?? FLOATING_OBJECT.DRAG_AREA,
    sideArea: body.sideArea ?? FLOATING_OBJECT.DRAG_AREA * 0.6,
    timeSeconds,
    turbulenceStrength,
    turbulenceFrequency,
  };
}

// Pure (sampleSWEFlow.ts) so the sim worker stages buoyancy with the same code.
export { MAX_STAGE_OFFSET, stagedWaterLevel };

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

function toFlowGrid(
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

interface BedState {
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

interface RouterState {
  router: RiverRouter | null;
  /** The run the router was spun up for; a new run (or hour) re-routes from launch. */
  session: unknown;
  launchHour: number;
}

/**
 * The router for the current run, rebuilt when the run or its launch hour
 * changes. Null without the ABI-10 exports — the window then steps with every
 * edge transmissive, exactly as before routing.
 */
function currentRouter(wasm: WatershedNativeModule | null, state: RouterState): RiverRouter | null {
  if (!wasm) return null;
  const session = getRunSession();
  const launchHour = getActiveLaunchHour();
  if (state.router && state.session === session && state.launchHour === launchHour) return state.router;
  state.router?.dispose();
  state.router = createRiverRouter(wasm, getRoutingReach(), launchHour, {
    forecast: { ...DEFAULT_FORECAST_INPUTS, weather: getActiveWeather() },
  });
  state.session = session;
  state.launchHour = launchHour;
  return state.router;
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

interface WorkerRouterState {
  /** Proxy the router was sent to; a different one (never, today) re-sends. */
  proxy: SimWorkerProxy | null;
  session: unknown;
  launchHour: number;
  reach: RoutingReach | null;
}

/**
 * `currentRouter` for the `wasm-worker` backend: the router lives in the sim
 * worker. (Re)send it when the run or its launch hour changes — the same
 * trigger, at the same point in the frame, as the main-thread rebuild — and
 * return the chain index the frame's SCROLL / STEP carry. No Embind here.
 */
function syncWorkerRouter(grid: WorkerSweSim, state: WorkerRouterState): number | null {
  const session = getRunSession();
  const launchHour = getActiveLaunchHour();
  if (state.proxy !== grid.proxy || state.session !== session || state.launchHour !== launchHour || !state.reach) {
    const reach = getRoutingReach();
    grid.proxy.post({
      type: 'ROUTER',
      reach,
      launchHour,
      forecast: { ...DEFAULT_FORECAST_INPUTS, weather: getActiveWeather() },
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

/** What a force sample is applied to when its result lands: the vehicle (by its rigid body) or a debris body. */
type ForceTarget = { vehicle: object } | { body: WaterForceBody };

/**
 * Apply force results that landed from the sim worker since the last frame,
 * with the dt of the frame that sampled them, to bodies still registered. The
 * vehicle takes its result only while this thread (not the Rapier worker) owns
 * its force — the one-owner rule of waterForceAuthority.ts, checked at apply.
 */
function applyWorkerForces(
  requests: SimForceRequests<ForceTarget>,
  bodies: readonly WaterForceBody[],
  vehicleBody: object | null,
  workerOwnsVehicleForces: boolean,
  vehicleFlowRef: { current: SWEFlowSample | null },
): void {
  const landed = requests.drain();
  if (landed.length === 0) return;
  const registered = new Set(bodies);
  for (const batch of landed) {
    for (let i = 0; i < batch.count; i += 1) {
      const target = batch.targets[i];
      let body: WaterForceBody | null = null;
      if ('vehicle' in target) {
        if (workerOwnsVehicleForces || target.vehicle !== vehicleBody) continue;
        body = bodies[0] ?? null;
        vehicleFlowRef.current = readForceFlow(batch.results, i);
      } else if (registered.has(target.body)) {
        body = target.body;
      }
      if (!body) continue;
      const force = readForceResult(batch.results, i);
      try {
        body.applyImpulse(
          {
            x: force.forceX * batch.dt * PHYSICS_SCALE,
            y: force.forceY * batch.dt * PHYSICS_SCALE,
            z: force.forceZ * batch.dt * PHYSICS_SCALE,
          },
          true,
        );
      } catch {
        // skip unstable body this frame
      }
    }
    requests.release(batch.results);
  }
}

interface WorkerForceFrame {
  bodies: readonly WaterForceBody[];
  vehicleBody: object | null;
  vehicleType: VehicleType;
  workerOwnsVehicleForces: boolean;
  gridId: number;
  originX: number;
  originZ: number;
  dt: number;
  timeSeconds: number;
  flowSpeed: number;
  waterLevel: number;
  turbulenceStrength: number;
  turbulenceFrequency: number;
  dragScale: number;
}

/**
 * Pack this frame's bodies for the sim worker (simForces.ts wire format): the
 * same configs the main-thread loop builds, with the AUTHORED flow speed and
 * water level — the worker samples and stages them on the stepped field.
 */
function postWorkerForces(requests: SimForceRequests<ForceTarget>, frame: WorkerForceFrame): void {
  const { bodies, vehicleBody } = frame;
  const samples = requests.acquire(bodies.length);
  const targets: ForceTarget[] = [];
  for (let i = 0; i < bodies.length && (targets.length + 1) * FORCE_SAMPLE_STRIDE <= samples.length; i += 1) {
    const body = bodies[i];
    try {
      const pos = body.translation();
      const vel = body.linvel();
      if (!pos || !vel) continue;
      const isVehicle = i === 0 && vehicleBody != null;
      if (shouldSkipMainThreadVehicleForce(isVehicle, frame.workerOwnsVehicleForces)) continue;
      const config = isVehicle
        ? vehicleForceConfig(
            frame.vehicleType,
            frame.flowSpeed,
            frame.waterLevel,
            frame.timeSeconds,
            frame.turbulenceStrength,
            frame.turbulenceFrequency,
            frame.dragScale,
          )
        : floatingForceConfig(
            frame.flowSpeed,
            frame.waterLevel,
            frame.timeSeconds,
            body,
            frame.turbulenceStrength * 0.8,
            frame.turbulenceFrequency,
            frame.dragScale,
          );
      writeForceSample(
        samples,
        targets.length,
        { position: pos, velocity: vel },
        config,
        frame.flowSpeed,
        isVehicle ? 1 : FLOATING_OBJECT.FLOW_INFLUENCE,
      );
      targets.push(isVehicle ? { vehicle: vehicleBody } : { body });
    } catch {
      // skip unstable body this frame
    }
  }
  if (targets.length === 0) {
    requests.release(samples);
    return;
  }
  requests.send(frame.gridId, frame.originX, frame.originZ, samples, targets, frame.dt);
}

export function WaterForceSystem({
  vehicleRef,
  vehicleType = 'runner',
  flowSpeed = 1.2,
  waterLevel = WATER_LEVEL,
  turbulenceStrength = 0.1,
  turbulenceFrequency = 2.4,
}: WaterForceSystemProps) {
  const wasmRef = useRef<WatershedNativeModule | null>(null);
  const gridRef = useRef<SweSim | null>(null);
  const uploadedVersionRef = useRef(-1);
  const textureRef = useRef<THREE.DataTexture | null>(null);
  const flowTextureRef = useRef<THREE.DataTexture | null>(null);
  const originRef = useRef({ x: 0, z: 0 });
  // Where the live grid's window sits on the world's cell lattice. Null until
  // the first frame after the grid is (re)built; the field is scrolled by the
  // whole-cell change of this between frames.
  const windowRef = useRef<SweWindow | null>(null);
  const statusRef = useRef<'loading' | 'ready' | 'fallback'>('loading');
  const stepAccumulatorRef = useRef(0);
  // Bed refresh bookkeeping: the sampled bathymetry only needs re-rasterizing
  // when the window slides a whole cell or the treadmill changes segments.
  const bedStateRef = useRef({ valid: false, revision: -1, originX: 0, originZ: 0 });
  const routerRef = useRef<RouterState>({ router: null, session: null, launchHour: Number.NaN });
  const workerRouterRef = useRef<WorkerRouterState>({
    proxy: null,
    session: null,
    launchHour: Number.NaN,
    reach: null,
  });
  // Set once the sim worker is READY: from then on forces run there, not here.
  const simProxyRef = useRef<SimWorkerProxy | null>(null);
  const forceRequestsRef = useRef<SimForceRequests<ForceTarget> | null>(null);
  // The vehicle's flow as the sim worker last sampled it (debug only).
  const workerVehicleFlowRef = useRef<SWEFlowSample | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const mountedRef = useRef(false);

  // The main-thread module — loaded only when this session's stepper is on
  // this thread (`wasm-main`: `?simWorker=0`, no Worker, a failed worker
  // handshake, or a failed WGSL init). A sim-worker boot never instantiates
  // it here, and a native-WebGPU boot does not either: one module per session.
  const loadMainWasm = useCallback(() => {
    getWasm()
      .then((wasm) => {
        if (!mountedRef.current) return;
        wasmRef.current = wasm;
        statusRef.current = 'ready';
        bindChoreWasm(wasm);
        setWasmReady(true);
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        statusRef.current = 'fallback';
        console.error('[WaterForceSystem] native init failed; using TypeScript fallbacks', error);
        bindChoreWasm(null);
        updateSWEHeightFieldSnapshot({ enabled: false, texture: null });
        setSWEStatus(false, null);
      });
  }, []);

  // Visual SWE budget follows the live quality preset (LODManager may downgrade
  // it adaptively). Force math below is NOT gated — it is gameplay-affecting.
  const quality = useQualityPreset();
  const budget = useMemo(() => sweBudgetForQuality(quality), [quality]);

  useEffect(() => {
    setWaterForceSystemActive(true);
    mountedRef.current = true;
    let cancelled = false;

    const decision = resolveSweSimBackendDecision();
    if (decision.backend === 'wasm-worker') {
      // Start the handshake now, so the grid effect below finds the worker
      // READY. Once READY it owns the water forces (Phase B) and the chores.
      getSimWorkerProxy()
        .then((proxy) => {
          if (cancelled || proxy.failed) return;
          simProxyRef.current = proxy;
          forceRequestsRef.current = createSimForceRequests<ForceTarget>(proxy);
          statusRef.current = 'ready';
        })
        .catch(() => {
          if (cancelled) return;
          // Nothing has stepped in the worker: its module never existed, so
          // the main-thread one is still this session's only module.
          demoteSweSimBackendToWasmMain();
          loadMainWasm();
        });
    } else if (decision.backend === 'wasm-main') {
      loadMainWasm();
    } else {
      // Native WebGPU: the WGSL twin steps, forces take the TS math, and the
      // C++ router is absent — the window's edge takes the rest inflow.
      statusRef.current = 'fallback';
      console.info('[WaterForceSystem] native WebGPU: no WASM module this session (TS forces, unrouted edge)');
    }

    return () => {
      cancelled = true;
      mountedRef.current = false;
      bindHeightfieldChoreWorker(null);
      routerRef.current.router?.dispose();
      routerRef.current = { router: null, session: null, launchHour: Number.NaN };
      workerRouterRef.current.proxy?.post({ type: 'DISPOSE_ROUTER' });
      workerRouterRef.current = { proxy: null, session: null, launchHour: Number.NaN, reach: null };
      forceRequestsRef.current?.dispose();
      forceRequestsRef.current = null;
      simProxyRef.current = null;
      workerVehicleFlowRef.current = null;
      setWaterForceSystemActive(false);
      registerVehicleWaterBody(null);
      clearSWEHeightField();
      clearSWEBedSnapshot();
      setSWEStatus(false, null);
    };
  }, [loadMainWasm]);

  // Grid + upload texture are sized by the budget, so a quality change
  // reallocates both. `low` allocates nothing at all. The solver backend was
  // fixed for the session at first use (sweBackend.ts): C++ WASM in the sim
  // worker (or on the main thread), or its WGSL twin on a native-WebGPU boot —
  // never two in one session.
  useEffect(() => {
    setSWEActiveBudget(budget);

    const wasm = wasmRef.current;
    const decision = resolveSweSimBackendDecision();
    const device = decision.backend === 'wgsl' ? getSessionGpuDevice() : null;
    const canStep = device !== null || wasm !== null || decision.backend === 'wasm-worker';
    if (!budget.enabled || !canStep) {
      updateSWEHeightFieldSnapshot({ enabled: false, texture: null, flowTexture: null });
      setSWEStatus(false, null);
      return;
    }

    let cancelled = false;
    let sim: SweSim | null = null;
    let unsubscribeFatal: (() => void) | null = null;
    const texture = new THREE.DataTexture(
      new Float32Array(budget.width * budget.height),
      budget.width,
      budget.height,
      THREE.RedFormat,
      THREE.FloatType,
    );
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    const flowTexture = new THREE.DataTexture(
      new Float32Array(budget.width * budget.height * SWE_FLOW_CHANNELS),
      budget.width,
      budget.height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    flowTexture.minFilter = THREE.LinearFilter;
    flowTexture.magFilter = THREE.LinearFilter;
    flowTexture.wrapS = THREE.ClampToEdgeWrapping;
    flowTexture.wrapT = THREE.ClampToEdgeWrapping;

    // SWE off, as when native init fails: the analytic surface and fallback flow.
    const disableSwe = () => {
      gridRef.current = null;
      updateSWEHeightFieldSnapshot({ enabled: false, texture: null, flowTexture: null });
      setSWEStatus(false, null);
    };

    const install = (next: SweSim) => {
      sim = next;
      gridRef.current = next;
      textureRef.current = texture;
      flowTextureRef.current = flowTexture;
      stepAccumulatorRef.current = 0;
      uploadedVersionRef.current = -1;
      bedStateRef.current = { valid: false, revision: -1, originX: 0, originZ: 0 };
      windowRef.current = null;
      setSWEStatus(true, `${budget.width}x${budget.height} ${next.backend}`);
      console.info(
        `[SWE] backend=${next.backend} (${resolveSweSimBackendDecision().reason}) grid=${budget.width}x${budget.height}`,
      );
    };

    if (device) {
      createWgslSweSim(device, budget.width, budget.height, budget.cellSize)
        .then((next) => {
          if (cancelled) {
            next.dispose();
            return;
          }
          install(next);
        })
        .catch((error) => {
          if (cancelled) return;
          // Nothing has stepped yet, so falling back keeps "one backend per
          // session" — the WGSL field never existed.
          console.error('[WaterForceSystem] WGSL SWE init failed; using the WASM stepper', error);
          demoteSweSimBackendToWasm();
          // The module loads only now; `wasmReady` re-runs this effect on wasm-main.
          const fallbackWasm = wasmRef.current;
          if (fallbackWasm) install(createWasmSweSim(fallbackWasm, budget.width, budget.height, budget.cellSize));
          else loadMainWasm();
        });
    } else if (decision.backend === 'wasm-worker') {
      getSimWorkerProxy()
        .then((proxy) => {
          if (cancelled) return;
          if (proxy.failed) {
            // The worker died after an earlier grid had stepped in it; a fresh
            // main-thread field would be a second backend this session.
            disableSwe();
            return;
          }
          const next = createWorkerSweSim(proxy, budget.width, budget.height, budget.cellSize);
          unsubscribeFatal = proxy.onFatal(() => {
            bindHeightfieldChoreWorker(null);
            if (gridRef.current === next) disableSwe();
          });
          // The debug-stat chores run on the worker's module, over its field.
          bindHeightfieldChoreWorker((thumbWidth, thumbHeight) =>
            proxy.requestChores(next.gridId, thumbWidth, thumbHeight));
          install(next);
        })
        .catch((error) => {
          if (cancelled) return;
          // Nothing has stepped in the worker, so the main-thread stepper is
          // still this session's only backend.
          console.warn('[WaterForceSystem] sim worker unavailable; stepping SWE on the main thread', error);
          demoteSweSimBackendToWasmMain();
          // The mount effect loads the main module; `wasmReady` re-runs this effect.
          const fallbackWasm = wasmRef.current;
          if (fallbackWasm) install(createWasmSweSim(fallbackWasm, budget.width, budget.height, budget.cellSize));
        });
    } else if (wasm) {
      install(createWasmSweSim(wasm, budget.width, budget.height, budget.cellSize));
    }

    return () => {
      cancelled = true;
      unsubscribeFatal?.();
      bindHeightfieldChoreWorker(null);
      sim?.dispose();
      gridRef.current = null;
      texture.dispose();
      flowTexture.dispose();
      textureRef.current = null;
      flowTextureRef.current = null;
      bedStateRef.current.valid = false;
      clearSWEBedSnapshot();
      updateSWEHeightFieldSnapshot({ enabled: false, texture: null, flowTexture: null });
      setSWEStatus(false, null);
    };
  }, [budget, wasmReady, loadMainWasm]);

  useFrame((state, delta) => {
    const vehicleBody = vehicleRef.current;
    if (vehicleBody?.applyImpulse) {
      registerVehicleWaterBody({
        translation: () => vehicleBody.translation(),
        linvel: () => vehicleBody.linvel(),
        applyImpulse: (impulse, wake) => vehicleBody.applyImpulse!(impulse, wake),
      });
    }

    const bodies = collectWaterForceBodies();
    if (bodies.length === 0) return;

    const dt = Math.min(delta, 0.05);
    const timeSeconds = state.clock.elapsedTime;
    const workerOwnsVehicleForces = isPhysicsWorkerActive();
    // Snow thickens the water the hull is in (#464): a lower flow cap on every
    // force path (main, sim worker, Rapier worker), more drag where the config
    // is built here. Identity for any other weather.
    const hull = weatherHullScale(getActiveWeather());
    const hullFlowSpeed = flowSpeed * hull.flowCapScale;
    const anchor = vehicleBody?.translation?.() ?? bodies[0].translation();
    // The window centres on the vehicle but sits on the world's cell lattice,
    // moving only by whole cells: a cell keeps its world position while it
    // survives. Every consumer below reads this origin, never the raw anchor.
    const advance = advanceSweWindow(windowRef.current, anchor.x, anchor.z, budget);
    const sweWindow = advance?.window ?? windowRef.current;
    const originX = sweWindow?.originX ?? anchor.x - (budget.width * budget.cellSize) * 0.5;
    const originZ = sweWindow?.originZ ?? anchor.z - (budget.height * budget.cellSize) * 0.5;
    originRef.current = { x: originX, z: originZ };

    const grid = gridRef.current;
    const texture = textureRef.current;
    const flowTexture = flowTextureRef.current;
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
      const chainIndex = remote ? syncWorkerRouter(remote, workerRouterRef.current) : null;
      const router = remote ? null : currentRouter(wasmRef.current, routerRef.current);
      const routed = remote ? null : routedInflow(router);
      const fill = routed?.inflow ?? SWE_REST_INFLOW;
      if (advance) {
        if (remote) {
          const route = { chainIndex };
          if (windowRef.current === null) {
            remote.scrollRouted(grid.width, 0, route, true, originX, originZ);
          } else if (advance.shiftX !== 0 || advance.shiftZ !== 0) {
            remote.scrollRouted(advance.shiftX, advance.shiftZ, route, false, originX, originZ);
          }
        } else if (windowRef.current === null && routed) {
          // A fresh window starts as the river it sits in, so the routed stage
          // does not have to bore in from the edge on every rebuild.
          grid.scroll(grid.width, 0, fill);
        } else if (advance.shiftX !== 0 || advance.shiftZ !== 0) {
          grid.scroll(advance.shiftX, advance.shiftZ, fill);
        }
        windowRef.current = advance.window;
      }
      remote?.setOrigin(originX, originZ);

      // Step-rate budget: accumulate render deltas and take one SWE step per
      // budgeted interval, so a 30Hz preset costs half a 60Hz preset's steps.
      refreshBed(grid, originX, originZ, budget, bedStateRef.current);

      const interval = sweStepInterval(budget);
      stepAccumulatorRef.current += dt;
      if (stepAccumulatorRef.current >= interval) {
        const stepDt = Math.min(stepAccumulatorRef.current, 0.05);
        stepAccumulatorRef.current = 0;
        router?.advance(stepDt);

        applyDisturbances(grid, originX, originZ, consumeSWEDisturbances(), budget);

        // Authored hydro events run after the step, through the same backend.
        const hydroEvents = parseHydroEvents(getActiveMap().levelData.hydroEvents);
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
        if (remote) remote.stepRouted(stepInput, { chainIndex });
        else grid.step(stepInput);
      }
      // WASM bumps fieldVersion inside step(); WGSL when its readback lands.
      if (grid.fieldVersion !== uploadedVersionRef.current) {
        uploadedVersionRef.current = grid.fieldVersion;
        uploadHeightTexture(grid, texture, flowTexture, originX, originZ, budget);
        runHeightfieldChores(grid.h, grid.width, grid.height);
      } else {
        // Grid didn't step, but the player moved — keep the sampling window
        // anchored so the displacement doesn't lag behind the camera.
        updateSWEHeightFieldSnapshot({ originX, originZ });
      }
    }

    const sweEnabled = Boolean(budget.enabled && grid);

    // Forces in the sim worker (Phase B): the field the hull reads is the one
    // being stepped. A dead worker drops back to TS math here (SWE is off then).
    const simProxy = simProxyRef.current;
    const requests = simProxy && !simProxy.failed ? forceRequestsRef.current : null;
    if (requests) {
      applyWorkerForces(requests, bodies, vehicleBody, workerOwnsVehicleForces, workerVehicleFlowRef);
      // The Rapier worker samples the sim worker itself (hull link): authored values only.
      setPhysicsWorkerTickParams({
        flowSpeed: hullFlowSpeed,
        waterLevel,
        turbulenceStrength,
        turbulenceFrequency,
        flowDirX: FALLBACK_FLOW_DIR.x,
        flowDirZ: FALLBACK_FLOW_DIR.z,
        simFlow: true,
      });
      postWorkerForces(requests, {
        bodies,
        vehicleBody,
        vehicleType,
        workerOwnsVehicleForces,
        gridId: isWorkerSweSim(grid) ? grid.gridId : -1,
        originX,
        originZ,
        dt,
        timeSeconds,
        flowSpeed: hullFlowSpeed,
        waterLevel,
        turbulenceStrength,
        turbulenceFrequency,
        dragScale: hull.dragScale,
      });
    }

    const flowGrid = !requests && grid ? toFlowGrid(grid, originX, originZ) : null;
    const vehicleFlow = requests
      ? (workerOwnsVehicleForces ? getPhysicsWorkerDiagnostics()?.sampledFlow : workerVehicleFlowRef.current) ??
        sampleSWEFlow({ worldX: anchor.x, worldZ: anchor.z, flowSpeed: hullFlowSpeed, grid: null, enabled: false })
      : sampleSWEFlow({
          worldX: anchor.x,
          worldZ: anchor.z,
          flowSpeed: hullFlowSpeed,
          grid: flowGrid,
          enabled: sweEnabled,
          stageSpeedBoost: SWE_STAGE_SPEED_BOOST,
        });
    if (!requests) {
      setPhysicsWorkerTickParams({
        flowSpeed: vehicleFlow.speed,
        waterLevel: stagedWaterLevel(waterLevel, vehicleFlow),
        turbulenceStrength,
        turbulenceFrequency,
        flowDirX: vehicleFlow.dirX,
        flowDirZ: vehicleFlow.dirZ,
        simFlow: false,
      });
    }

    // A worker that died mid-session leaves forces to the TS math; a sim-worker
    // or native-WebGPU session has no module on this thread at all.
    const nativeForces = simProxy?.failed ? null : wasmRef.current;
    for (let i = 0; !requests && i < bodies.length; i += 1) {
      const body = bodies[i];
      try {
        const pos = body.translation();
        const vel = body.linvel();
        if (!pos || !vel) continue;

        const isVehicle = i === 0 && vehicleBody != null;
        if (shouldSkipMainThreadVehicleForce(isVehicle, workerOwnsVehicleForces)) {
          continue;
        }
        const flow = isVehicle
          ? vehicleFlow
          : sampleSWEFlow({
              worldX: pos.x,
              worldZ: pos.z,
              flowSpeed: hullFlowSpeed,
              grid: flowGrid,
              enabled: sweEnabled,
              stageSpeedBoost: SWE_STAGE_SPEED_BOOST,
            });
        // Buoyancy reads the *local* surface, so an authored inflowPulse
        // floats the hull higher instead of only moving the mesh (#397).
        const localWaterLevel = stagedWaterLevel(waterLevel, flow);
        const config = isVehicle
          ? vehicleForceConfig(
              vehicleType,
              flow.speed,
              localWaterLevel,
              timeSeconds,
              turbulenceStrength,
              turbulenceFrequency,
              hull.dragScale,
            )
          : floatingForceConfig(
              flow.speed,
              localWaterLevel,
              timeSeconds,
              body,
              turbulenceStrength * 0.8,
              turbulenceFrequency,
              hull.dragScale,
            );

        const force = nativeForces
          ? nativeForces.calculateWaterForce(
              pos.x, pos.y, pos.z,
              vel.x, vel.y, vel.z,
              flow.dirX, flow.dirZ,
              config.flowSpeed,
              config.waterLevel,
              config.raftMass,
              config.raftVolume,
              config.dragCoefficient,
              config.frontalArea,
              config.sideArea,
              config.timeSeconds,
              config.turbulenceStrength,
              config.turbulenceFrequency,
            )
          : calculateWaterForceFallback(
              {
                position: pos,
                velocity: vel,
                flowDirection: { x: flow.dirX, z: flow.dirZ },
              },
              config,
            );

        body.applyImpulse(
          {
            x: force.forceX * dt * PHYSICS_SCALE,
            y: force.forceY * dt * PHYSICS_SCALE,
            z: force.forceZ * dt * PHYSICS_SCALE,
          },
          true,
        );
      } catch {
        // skip unstable body this frame
      }
    }

    if (typeof window !== 'undefined') {
      (window as any).__watershedWaterForceSystem = {
        status: statusRef.current,
        origin: originRef.current,
        sampleCount: bodies.length,
        sweBudget: budget,
        workerOwnsVehicleForces,
        forcesIn: requests ? 'sim-worker' : nativeForces ? 'main-wasm' : 'main-ts',
        forcesInFlight: requests?.inFlight ?? 0,
        sampledDir: [vehicleFlow.dirX, vehicleFlow.dirZ],
        sampledSpeed: vehicleFlow.speed,
        stage: vehicleFlow.surfaceOffset,
        stagedWaterLevel: stagedWaterLevel(waterLevel, vehicleFlow),
        fallbackDir: [FALLBACK_FLOW_DIR.x, FALLBACK_FLOW_DIR.z],
        source: vehicleFlow.source,
        wet: vehicleFlow.wet,
        workerDiagnostics: workerOwnsVehicleForces
          ? (window as any).__watershedPhysicsWorker?.waterForce
          : undefined,
      };
    }
  });

  return null;
}

export default WaterForceSystem;
