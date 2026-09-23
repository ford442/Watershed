/**
 * hydroContrast — does an authored hour actually change the river? (#397)
 *
 * The product gate for authored `hydroEvents[]` is not "the field was written"
 * but "the player can see and feel the difference". This module measures both
 * halves of that claim from the same source terms the runtime applies:
 *
 *   mesh  — max |Δη| and max |Δb| across the grid. η drives the SWE height
 *           texture FlowingWater displaces by; b is the bed the channel splits
 *           around, so a braid that only moves b still reads visually.
 *   hull  — sampleSWEFlow at the event centre, the exact sample
 *           WaterForceSystem feeds to calculateWaterForce. Speed, direction and
 *           stage deltas are what the Rapier body integrates.
 *
 * No WASM and no stepper: source terms only, over a seeded downstream current.
 * That keeps the measurement deterministic in CI while still exercising the
 * kernel the native path shares (`applySWEEvent`, twin of applySWEEventFallback).
 */

import {
  applySWEEventFallback,
  eventsActiveAtHour,
  hydroKindToInt,
  type HydroEvent,
  type SWEEventGrid,
} from './hydroEvents';
import { sampleSWEFlow } from './sampleSWEFlow';
import { SWE_MEAN_DEPTH } from './SWEHeightField';
import type { SweEventCall } from './sweSim';

/** Seeded downstream current (−Z), so `roughness` has something to damp. */
export const CONTRAST_BASE_FLOW = 1.2;
/** Authored cap handed to sampleSWEFlow — matches a mid-map flowSpeed. */
export const CONTRAST_FLOW_SPEED = 2;
const STEP_DT = 1 / 60;
const STEPS = 30;
const GRID = 48;
const CELL = 0.5;

export interface HydroContrastMargins {
  /** Metres of free-surface change the mesh must show. */
  minEtaDelta: number;
  /** Metres of bed change a braid must show. */
  minBedDelta: number;
  /**
   * Combined hull response: |Δspeed| (m/s) + |Δdir| (unit-vector distance)
   * + |Δstage| (m) at the event centre.
   */
  minHullDelta: number;
}

/**
 * Documented acceptance margins (#397).
 *
 * Deliberately coarse: they assert the difference is *playable*, not that a
 * particular kernel constant is frozen. Tuning an event down past these means
 * the hour stopped mattering and the author should know.
 */
export const HYDRO_CONTRAST_MARGINS: HydroContrastMargins = {
  minEtaDelta: 0.05,
  minBedDelta: 0.2,
  minHullDelta: 0.05,
};

export interface HydroHourContrast {
  segmentIndex: number;
  /** Event ids live at each hour, for reporting which authoring is under test. */
  idsA: string[];
  idsB: string[];
  maxEtaDelta: number;
  maxBedDelta: number;
  hullSpeedDelta: number;
  hullDirDelta: number;
  hullStageDelta: number;
  /** Sum of the three hull deltas — compared against `minHullDelta`. */
  hullDelta: number;
}

/** Fresh contrast grid: 48×48 at 0.5 m, centred on the world origin, seeded current. */
export function makeContrastGrid(): SWEEventGrid {
  const n = GRID * GRID;
  const grid: SWEEventGrid = {
    h: new Float32Array(n),
    u: new Float32Array(n),
    w: new Float32Array(n),
    b: new Float32Array(n),
    width: GRID,
    height: GRID,
    cellSize: CELL,
    originX: -(GRID * CELL) * 0.5,
    originZ: -(GRID * CELL) * 0.5,
    stillDepth: SWE_MEAN_DEPTH,
  };
  grid.w.fill(-CONTRAST_BASE_FLOW);
  return grid;
}

/**
 * Every `applySWEEvent` call one hour makes on one segment, in order: 30 steps
 * of the active events, centred on the segment's path midpoint at world origin
 * (the runtime places it via `getRegisteredBathymetrySource`; the offset is
 * irrelevant to a delta).
 */
export function hourEventCalls(
  events: readonly HydroEvent[] | undefined,
  hour: number,
  segmentIndex: number,
): SweEventCall[] {
  const active = eventsActiveAtHour(events, hour).filter(
    (event) => event.segmentIndex === segmentIndex,
  );
  const calls: SweEventCall[] = [];
  for (let step = 0; step < STEPS; step += 1) {
    for (const event of active) {
      calls.push({
        kind: hydroKindToInt(event.kind),
        cx: event.lateralOffset ?? 0,
        cz: 0,
        radius: event.radius ?? 8,
        strength: event.strength ?? 1,
        dt: STEP_DT,
      });
    }
  }
  return calls;
}

/** Apply one hour's events for a single segment onto a fresh grid (TS kernel). */
export function simulateHourGrid(
  events: readonly HydroEvent[] | undefined,
  hour: number,
  segmentIndex: number,
): SWEEventGrid {
  const grid = makeContrastGrid();
  for (const call of hourEventCalls(events, hour, segmentIndex)) {
    applySWEEventFallback(grid, call.kind, call.cx, call.cz, call.radius, call.strength, call.dt);
  }
  return grid;
}

/**
 * Applies a list of event calls to a contrast grid in place. The default is the
 * TypeScript kernel; parity tests pass the WASM export or the WGSL dispatch so
 * the margins are checked on every solver backend (#435).
 */
export type HydroEventApplier = (grid: SWEEventGrid, calls: readonly SweEventCall[]) => void | Promise<void>;

function hullSample(grid: SWEEventGrid, worldX: number, worldZ: number) {
  return sampleSWEFlow({
    worldX,
    worldZ,
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
  });
}

/** Segment indices any of `events` touches, ascending. */
export function hydroSegmentIndices(events: readonly HydroEvent[] | undefined): number[] {
  return [...new Set((events ?? []).map((event) => event.segmentIndex))].sort((a, b) => a - b);
}

/**
 * Compare two launch hours on one segment. Positive deltas mean the hour is
 * visible (η/b) and felt (hull sample) — the two halves of the #397 gate.
 */
export function measureHydroHourContrast(
  events: readonly HydroEvent[] | undefined,
  segmentIndex: number,
  hourA: number,
  hourB: number,
): HydroHourContrast {
  const a = simulateHourGrid(events, hourA, segmentIndex);
  const b = simulateHourGrid(events, hourB, segmentIndex);
  return contrastBetween(events, segmentIndex, hourA, hourB, a, b);
}

/** `measureHydroHourContrast` with the events applied by `apply` instead of the TS kernel. */
export async function measureHydroHourContrastWith(
  apply: HydroEventApplier,
  events: readonly HydroEvent[] | undefined,
  segmentIndex: number,
  hourA: number,
  hourB: number,
): Promise<HydroHourContrast> {
  const a = makeContrastGrid();
  const b = makeContrastGrid();
  await apply(a, hourEventCalls(events, hourA, segmentIndex));
  await apply(b, hourEventCalls(events, hourB, segmentIndex));
  return contrastBetween(events, segmentIndex, hourA, hourB, a, b);
}

function contrastBetween(
  events: readonly HydroEvent[] | undefined,
  segmentIndex: number,
  hourA: number,
  hourB: number,
  a: SWEEventGrid,
  b: SWEEventGrid,
): HydroHourContrast {
  let maxEtaDelta = 0;
  let maxBedDelta = 0;
  for (let i = 0; i < a.h.length; i += 1) {
    maxEtaDelta = Math.max(maxEtaDelta, Math.abs(a.h[i] - b.h[i]));
    maxBedDelta = Math.max(maxBedDelta, Math.abs(a.b[i] - b.b[i]));
  }

  // Sample where the authored events actually sit, not the grid centre: a
  // lateralOffset braid is felt off-axis.
  const offsets = new Set<number>([0]);
  for (const event of [...eventsActiveAtHour(events, hourA), ...eventsActiveAtHour(events, hourB)]) {
    if (event.segmentIndex === segmentIndex) offsets.add(event.lateralOffset ?? 0);
  }

  let hullSpeedDelta = 0;
  let hullDirDelta = 0;
  let hullStageDelta = 0;
  for (const offset of offsets) {
    const sa = hullSample(a, offset, 0);
    const sb = hullSample(b, offset, 0);
    hullSpeedDelta = Math.max(hullSpeedDelta, Math.abs(sa.speed - sb.speed));
    hullDirDelta = Math.max(hullDirDelta, Math.hypot(sa.dirX - sb.dirX, sa.dirZ - sb.dirZ));
    hullStageDelta = Math.max(hullStageDelta, Math.abs(sa.surfaceOffset - sb.surfaceOffset));
  }

  return {
    segmentIndex,
    idsA: eventsActiveAtHour(events, hourA)
      .filter((e) => e.segmentIndex === segmentIndex)
      .map((e) => e.id),
    idsB: eventsActiveAtHour(events, hourB)
      .filter((e) => e.segmentIndex === segmentIndex)
      .map((e) => e.id),
    maxEtaDelta,
    maxBedDelta,
    hullSpeedDelta,
    hullDirDelta,
    hullStageDelta,
    hullDelta: hullSpeedDelta + hullDirDelta + hullStageDelta,
  };
}
