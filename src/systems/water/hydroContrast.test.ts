import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import glacial from '../../maps/glacial_source.json';
import hydro from '../../maps/hydro_dam.json';
import delta from '../../maps/delta_rapids.json';
import lumber from '../../maps/lumber_flume.json';
import meander from '../../maps/meander_to_waterfall.json';
import { applySWEEventFallback, eventsActiveAtHour, parseHydroEvents, hydroVortexSegments } from './hydroEvents';
import {
  CONTRAST_FLOW_SPEED,
  HYDRO_CONTRAST_MARGINS,
  hourEventCalls,
  hydroSegmentIndices,
  measureHydroHourContrast,
  measureHydroHourContrastWith,
  makeContrastGrid,
  measureEdgeStageContrastWith,
  routedEdgeEtaAt,
  simulateHourGrid,
  type HydroEdgeStepper,
  type HydroEventApplier,
} from './hydroContrast';
import { createWasmSweSim } from './sweSim';
import type { WatershedNativeModule } from './WatershedWasm';
import { SWE_MEAN_DEPTH } from './SWEHeightField';
import {
  ROUTING_NOMINAL_DISCHARGE,
  ROUTING_SPINUP_HOURS,
  createRiverRouter,
  headDischargeAtHour,
} from './riverRouter';
import { getRoutingReach, routingChainIndex } from '../map/routingReach';
import { sampleSWEFlow } from './sampleSWEFlow';
import { shouldApplyAuthoredVortexImpulse } from '../../physics/waterForceAuthority';
import { buildForecastSamples, FLOW_FORECAST_STATES } from '../map/flowForecast';
import { DAM_RELEASE_SCHEDULE } from '../../experience/constants';

const SCOUT_HOUR = 6;
const DAM_HOUR = 14;

/** Shipped maps the #397 gate covers — meander is the default ACTIVE_MAP_ID. */
const GATED_MAPS = [
  { id: 'glacial', events: parseHydroEvents(glacial.hydroEvents) },
  { id: 'meander', events: parseHydroEvents(meander.hydroEvents) },
  { id: 'hydro', events: parseHydroEvents(hydro.hydroEvents) },
  { id: 'delta', events: parseHydroEvents(delta.hydroEvents) },
];

describe('hydroContrast — 06:00 vs 14:00 on the shipped maps', () => {
  it.each(GATED_MAPS)('$id changes both mesh and hull', ({ events }) => {
    const segments = hydroSegmentIndices(events);
    expect(segments.length).toBeGreaterThan(0);

    const contrasts = segments.map((segmentIndex) =>
      measureHydroHourContrast(events, segmentIndex, SCOUT_HOUR, DAM_HOUR),
    );

    // Every authored segment has a different cast at the two hours…
    for (const contrast of contrasts) {
      expect(contrast.idsA).not.toEqual(contrast.idsB);
      expect(contrast.hullDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minHullDelta);
    }

    // …and the water mesh moves somewhere on the map, in η or in bed.
    const meshMoved = contrasts.some(
      (c) =>
        c.maxEtaDelta > HYDRO_CONTRAST_MARGINS.minEtaDelta ||
        c.maxBedDelta > HYDRO_CONTRAST_MARGINS.minBedDelta,
    );
    expect(meshMoved).toBe(true);
  });

  // Two different non-empty casts, not "something at 14:00 vs nothing at dawn":
  // the scout hour has to show its own water, not just the absence of a pulse.
  it.each(GATED_MAPS)('$id authors an event at both the scout hour and the dam hour', ({ events }) => {
    expect(eventsActiveAtHour(events, SCOUT_HOUR).length).toBeGreaterThan(0);
    expect(eventsActiveAtHour(events, DAM_HOUR).length).toBeGreaterThan(0);
  });

  it('meander: the pond dawn roughness alone changes the hull on seg 16', () => {
    const events = parseHydroEvents(meander.hydroEvents);
    const dawn = events.filter((e) => e.segmentIndex === 16 && eventsActiveAtHour([e], SCOUT_HOUR).length);
    expect(dawn.map((e) => e.kind)).toEqual(['roughness']);
    const contrast = measureHydroHourContrast(dawn, 16, SCOUT_HOUR, DAM_HOUR);
    expect(contrast.idsA).not.toEqual(contrast.idsB);
    expect(contrast.hullDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minHullDelta);
  });

  it('the hydro dam pulse raises stage and rides faster at 14:00', () => {
    const events = parseHydroEvents(hydro.hydroEvents);
    const contrast = measureHydroHourContrast(events, 4, SCOUT_HOUR, DAM_HOUR);
    expect(contrast.hullStageDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
    expect(contrast.hullSpeedDelta).toBeGreaterThan(0);
  });

  it('meander: the waterfall pulse raises stage and the pond braid moves the bed at 14:00', () => {
    const events = parseHydroEvents(meander.hydroEvents);
    const fall = measureHydroHourContrast(events, 14, SCOUT_HOUR, DAM_HOUR);
    expect(fall.hullStageDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
    expect(fall.maxEtaDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);

    const pond = measureHydroHourContrast(events, 16, SCOUT_HOUR, DAM_HOUR);
    expect(pond.maxBedDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minBedDelta);
    expect(pond.hullDirDelta).toBeGreaterThan(0);
  });

  it('a braid moves the bed and pushes the hull laterally', () => {
    const events = parseHydroEvents(delta.hydroEvents);
    const contrast = measureHydroHourContrast(events, 9, SCOUT_HOUR, DAM_HOUR);
    expect(contrast.maxBedDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minBedDelta);
    expect(contrast.hullDirDelta).toBeGreaterThan(0);
  });
});

describe('hydro vortex authority', () => {
  it('a live hydroEvent vortex owns its segment; VortexForceSystem stands down', () => {
    const events = parseHydroEvents(hydro.hydroEvents);
    const live = hydroVortexSegments(events, DAM_HOUR);
    expect([...live]).toEqual([5]);
    expect(shouldApplyAuthoredVortexImpulse(5, live)).toBe(false);
    expect(shouldApplyAuthoredVortexImpulse(4, live)).toBe(true);
  });

  it('outside the release window the authored vortex impulse is the fallback swirl', () => {
    const events = parseHydroEvents(hydro.hydroEvents);
    const live = hydroVortexSegments(events, SCOUT_HOUR);
    expect(live.size).toBe(0);
    expect(shouldApplyAuthoredVortexImpulse(5, live)).toBe(true);
  });
});

describe('lumber braid couples to washedOutGap', () => {
  it('the gap washout shoal is only authored on hours the gap actually opens', () => {
    const samples = buildForecastSamples({
      temperature: 8,
      snowpackIndex: 0.65,
      damReleaseSchedule: DAM_RELEASE_SCHEDULE,
      startHour: 0,
      horizonHours: 24,
    });
    const washedOutHours = new Set(
      samples.filter((s) => s.state === FLOW_FORECAST_STATES.WASHED_OUT).map((s) => s.hour % 24),
    );
    expect(washedOutHours.size).toBeGreaterThan(0);

    const braid = parseHydroEvents(lumber.hydroEvents).find((e) => e.kind === 'braid');
    expect(braid).toBeDefined();
    for (const hour of braid!.hours ?? []) {
      expect(washedOutHours.has(hour)).toBe(true);
    }
  });
});

describe('glacial slush roughness damps the hull', () => {
  const SLUSH_SEGMENT = 3;
  const SLUSH_HOUR = 13;
  /** No glacial event is authored here — the un-damped reference. */
  const CLEAR_HOUR = 20;

  function hullSpeedAt(hour: number): number {
    const grid = simulateHourGrid(parseHydroEvents(glacial.hydroEvents), hour, SLUSH_SEGMENT);
    return sampleSWEFlow({
      worldX: 0,
      worldZ: 0,
      flowSpeed: CONTRAST_FLOW_SPEED,
      grid: {
        h: grid.h,
        u: grid.u,
        w: grid.w,
        b: grid.b,
        width: grid.width,
        height: grid.height,
        cellSize: grid.cellSize,
        originX: grid.originX,
        originZ: grid.originZ,
      },
      enabled: true,
    }).speed;
  }

  it('slows u,w where the slush is authored, not just where it is drawn', () => {
    const slush = hullSpeedAt(SLUSH_HOUR);
    const clear = hullSpeedAt(CLEAR_HOUR);

    expect(clear).toBeGreaterThan(0);
    expect(slush).toBeLessThan(clear);
  });
});

describe('hydroContrast event appliers (#435)', () => {
  it('replays 30 steps of the hour’s active events, in authored order', () => {
    const events = parseHydroEvents(hydro.hydroEvents);
    const segment = hydroSegmentIndices(events)[0];
    const calls = hourEventCalls(events, DAM_HOUR, segment);
    expect(calls.length % 30).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.dt === 1 / 60)).toBe(true);
  });

  it('measures the same contrast through an injected TS applier as the built-in path', async () => {
    const events = parseHydroEvents(delta.hydroEvents);
    const tsApply: HydroEventApplier = (grid, calls) => {
      for (const c of calls) applySWEEventFallback(grid, c.kind, c.cx, c.cz, c.radius, c.strength, c.dt);
    };
    for (const segment of hydroSegmentIndices(events)) {
      const direct = measureHydroHourContrast(events, segment, SCOUT_HOUR, DAM_HOUR);
      const injected = await measureHydroHourContrastWith(tsApply, events, segment, SCOUT_HOUR, DAM_HOUR);
      expect(injected).toEqual(direct);
    }
  });
});

// -----------------------------------------------------------------------------
// Routed upstream edge (ABI 10). The hour reaches the solver through the
// window's boundary, not only through an authored disk. Needs the compiled
// binary, so it runs under `pnpm test:wasm` (WATERSHED_WASM_INTEGRATION=1).
// -----------------------------------------------------------------------------
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');
const wasmPath = resolve(publicDir, 'watershed_native.wasm');
const jsPath = resolve(publicDir, 'watershed_native.js');
const describeNative =
  process.env.WATERSHED_WASM_INTEGRATION === '1' && existsSync(wasmPath) ? describe : describe.skip;

/** The hydro segment the #397 dam pulse is authored on — the stilling basin reach. */
const HYDRO_BASIN_SEGMENT = 4;

describeNative('hydroContrast — the routed upstream edge (ABI 10)', () => {
  let wasm: WatershedNativeModule;

  beforeAll(async () => {
    const wasmBinary = readFileSync(wasmPath);
    const { default: create } = await import(/* @vite-ignore */ pathToFileURL(jsPath).href);
    wasm = await create({
      instantiateWasm: (imports: WebAssembly.Imports, receive: (i: WebAssembly.Instance) => void) => {
        WebAssembly.instantiate(wasmBinary, imports).then(({ instance }) => receive(instance));
        return {};
      },
    });
  });

  /** stepShallowWaterInflow on a contrast grid — no hydroEvents, only the edge. */
  const wasmEdgeStep: HydroEdgeStepper = (grid, edgeEta, steps, dt) => {
    const sim = createWasmSweSim(wasm, grid.width, grid.height, grid.cellSize);
    sim.h.set(grid.h);
    sim.u.set(grid.u);
    sim.w.set(grid.w);
    sim.b.set(grid.b);
    for (let s = 0; s < steps; s += 1) {
      sim.step({ dt, g: 9.80665, H: grid.stillDepth, originX: grid.originX, originZ: grid.originZ, events: [], edgeEta });
    }
    grid.h.set(sim.h);
    grid.u.set(sim.u);
    grid.w.set(sim.w);
    grid.b.set(sim.b);
    sim.dispose();
  };

  it('hydro 06:00 vs 14:00 moves the edge stage, the mesh and the hull through the boundary', async () => {
    const scout = routedEdgeEtaAt(wasm, 'hydro', HYDRO_BASIN_SEGMENT, SCOUT_HOUR);
    const dam = routedEdgeEtaAt(wasm, 'hydro', HYDRO_BASIN_SEGMENT, DAM_HOUR);
    expect(dam).toBeGreaterThan(scout);

    const contrast = await measureEdgeStageContrastWith(wasmEdgeStep, scout, dam);
    // Same margins as the authored-disk gate: the routed wave has to clear
    // them on its own. If it ever doesn't, raise the dam release in
    // DAM_RELEASE_SCHEDULE — do not loosen these.
    expect(contrast.edgeStageDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
    expect(contrast.maxEtaDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
    expect(contrast.hullStageDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
    expect(contrast.hullDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minHullDelta);
  });

  it('the dam hour is higher at the edge on every map of the chain, not only where a disk is authored', () => {
    for (const mapId of ['glacial', 'lumber', 'meander', 'hydro', 'delta'] as const) {
      const scout = routedEdgeEtaAt(wasm, mapId, 2, SCOUT_HOUR);
      const dam = routedEdgeEtaAt(wasm, mapId, 2, DAM_HOUR);
      expect(dam - scout, mapId).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
    }
  });

  it('a release reaches the hydro basin only after the routed lag', () => {
    const reach = getRoutingReach();
    // Launch at 12:30: the 14:00 release window opens at 13:00, 1800 s in.
    const launch = 12.5;
    const opens = 1800;
    const router = createRiverRouter(wasm, reach, launch)!;
    const k = routingChainIndex(reach, 'hydro', HYDRO_BASIN_SEGMENT)!;
    const lag = router.lag(k - 1); // dischargeInto(k) is segment k−1's outflow
    const base = headDischargeAtHour(launch);
    const release = headDischargeAtHour(14) - headDischargeAtHour(12);
    expect(release).toBeGreaterThan(0);

    const dt = 5;
    let headHalf = Number.NaN;
    let basinHalf = Number.NaN;
    let basinEarly = 0;
    for (let t = dt; t <= opens + 2 * lag; t += dt) {
      router.advance(dt);
      const head = (router.dischargeInto(0) - base) / release;
      const basin = (router.dischargeInto(k) - base) / release;
      if (Number.isNaN(headHalf) && head >= 0.5) headHalf = t;
      if (Number.isNaN(basinHalf) && basin >= 0.5) basinHalf = t;
      if (t < opens + 0.5 * lag) basinEarly = Math.max(basinEarly, Math.abs(basin));
    }
    router.dispose();

    expect(Math.abs(headHalf - opens)).toBeLessThanOrEqual(dt);
    expect(basinEarly).toBeLessThan(0.02);
    const delay = basinHalf - headHalf;
    expect(delay).toBeGreaterThan(0.75 * lag);
    expect(delay).toBeLessThan(1.25 * lag);
  });

  it('spin-up flushes the whole chain before launch', () => {
    const reach = getRoutingReach();
    const router = createRiverRouter(wasm, reach, DAM_HOUR)!;
    const chainLag = router.lag(reach.segments.length - 1);
    router.dispose();
    expect(chainLag).toBeGreaterThan(60);
    expect(chainLag).toBeLessThan((ROUTING_SPINUP_HOURS * 3600) / 3);
  });

  it('at the reference discharge the edge leaves still water still', async () => {
    // A flowRate-1 hour routes to exactly the reference discharge: edge η = 0.
    const q = ROUTING_NOMINAL_DISCHARGE;
    expect(wasm.routedEdgeState!(q, q, SWE_MEAN_DEPTH, 9.80665)).toEqual({ eta: 0, speed: 0 });
    const grid = makeContrastGrid();
    grid.w.fill(0); // still water, no seeded current
    await wasmEdgeStep(grid, 0, 240, 1 / 60);
    for (const plane of [grid.h, grid.u, grid.w]) {
      expect(Math.max(...Array.from(plane, Math.abs))).toBe(0);
    }
  });
});
