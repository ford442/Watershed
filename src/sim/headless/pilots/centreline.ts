/**
 * centreline.ts — pure pursuit on the river's centreline (#556 C).
 *
 * The runner steers by looking (see pilot.ts), so the pilot is a yaw controller: find where the
 * body is along the live segments' sampled centrelines, take a point `lookahead` metres further
 * down the same polyline, face it, hold forward. Sprint (the RB button) is a latch on the
 * stamina bar: on above `sprintOn`, off below `sprintOff` (the runner's own exhaustion lock
 * re-arms at 0.2), and only while the runner is under `targetSpeed`.
 *
 * The polyline is every live frame's `FRAME_SAMPLES + 1` samples keyed by `frame.index * 32 + j`
 * (the last sample of a segment and the first of the next are the same key), so a progress mark
 * survives the treadmill recycling segments, and the search for the nearest point only looks a
 * few samples around the last one (a meander's loops can bring two stretches close in x/z).
 *
 * Headless only: never imported by app code (scripts/check-dependency-direction.mjs).
 */
import { InputButton } from '../../../input/InputFrame';
import { FRAME_SAMPLES, type SegmentFrame } from '../../../systems/map/segmentFrames';
import { createPilot, yawToward, type Pilot, type PilotCommand, type PilotPolicy, type PilotView } from './pilot';
import type { HeadlessRun } from '../createHeadlessRun';

export interface CentrelineOptions {
  /** Metres of centreline ahead of the body to aim at (default 9). */
  lookahead?: number;
  /** Horizontal speed to hold, m/s: sprint only while under it (default 26). */
  targetSpeed?: number;
  /** Stamina above which sprint may start (default 0.5). */
  sprintOn?: number;
  /** Stamina below which a sprint is released (default 0.08). */
  sprintOff?: number;
  /**
   * Metres above the centreline at which the pilot is "in the air" (default 4). The runner falls
   * at terminal velocity (~8 m/s) while the river's floor drops faster than that on a steep
   * stretch: at run speed it overshoots the stretch and, at the next segment, the vertical
   * envelope (`yMax`), or drifts off a bend and falls past the hull.
   */
  dropAbove?: number;
  /** Horizontal speed to hold in the air, m/s: no forward push above it, no sprint (default 8). */
  airSpeed?: number;
  /** Aim point distance in the air, m (default 8). */
  airLookahead?: number;
  /** Frames at under `stuckSpeed` before the pilot taps JUMP (default 45). */
  stuckFrames?: number;
  /** Horizontal speed under which a forward-pushing pilot counts as stuck, m/s (default 1.5). */
  stuckSpeed?: number;
}

interface Point {
  key: number;
  x: number;
  y: number;
  z: number;
}

/** Everything the policy keeps between frames. */
interface ChainState {
  points: Point[];
  /** `frames` the chain was built from (the treadmill republishes a new array per pool change). */
  source: ReadonlyArray<SegmentFrame> | null;
  /** Index into `points` of the last nearest segment start. */
  cursor: number;
  sprinting: boolean;
  /** Consecutive frames spent pushing forward under `stuckSpeed`. */
  stuck: number;
}

/** Search radius, in polyline points, around the cursor before falling back to the whole chain. */
const SEARCH_BEHIND = 3;
const SEARCH_AHEAD = 10;
/** A nearest point farther than this (m, horizontal) is not trusted: search the whole chain. */
const LOST_DISTANCE = 60;

function rebuild(state: ChainState, frames: ReadonlyArray<SegmentFrame>): void {
  const byKey = new Map<number, Point>();
  for (const frame of frames) {
    for (let j = 0; j < frame.samples.length; j += 1) {
      const s = frame.samples[j];
      const key = frame.index * FRAME_SAMPLES + j;
      // The shared joint (j = 32 of one segment, j = 0 of the next) keeps the later segment's sample.
      byKey.set(key, { key, x: s[0], y: s[1], z: s[2] });
    }
  }
  const prevKey = state.points[state.cursor]?.key;
  state.points = [...byKey.values()].sort((a, b) => a.key - b.key);
  state.source = frames;
  if (prevKey === undefined) {
    state.cursor = 0;
    return;
  }
  const at = state.points.findIndex((p) => p.key >= prevKey);
  state.cursor = at < 0 ? state.points.length - 1 : at;
}

/** Nearest polyline segment (horizontal) within [lo, hi]: returns its start index, `t` along it, and the squared distance. */
function nearest(points: Point[], lo: number, hi: number, x: number, z: number): { i: number; t: number; d2: number } {
  let best = { i: lo, t: 0, d2: Infinity };
  const last = Math.min(hi, points.length - 2);
  for (let i = Math.max(0, lo); i <= last; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 1e-9 ? Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / len2)) : 0;
    const dx = a.x + abx * t - x;
    const dz = a.z + abz * t - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best.d2) best = { i, t, d2 };
  }
  return best;
}

/** The point `distance` metres (horizontal arclength) down the polyline from segment `i`, fraction `t`. */
function walk(points: Point[], i: number, t: number, distance: number, out: { x: number; y: number; z: number }): void {
  let seg = i;
  const a0 = points[seg];
  const b0 = points[seg + 1];
  let x = a0.x + (b0.x - a0.x) * t;
  let y = a0.y + (b0.y - a0.y) * t;
  let z = a0.z + (b0.z - a0.z) * t;
  let left = distance;
  while (seg + 1 < points.length) {
    const b = points[seg + 1];
    const len = Math.hypot(b.x - x, b.z - z);
    if (len >= left) {
      const k = len > 1e-9 ? left / len : 0;
      out.x = x + (b.x - x) * k;
      out.y = y + (b.y - y) * k;
      out.z = z + (b.z - z) * k;
      return;
    }
    left -= len;
    x = b.x;
    y = b.y;
    z = b.z;
    seg += 1;
  }
  out.x = x;
  out.y = y;
  out.z = z;
}

/** The centreline pursuit as a policy (stateful: one per pilot). */
export function centrelinePolicy(options: CentrelineOptions = {}): PilotPolicy {
  const lookahead = options.lookahead ?? 9;
  const targetSpeed = options.targetSpeed ?? 26;
  const sprintOn = options.sprintOn ?? 0.5;
  const sprintOff = options.sprintOff ?? 0.08;
  const dropAbove = options.dropAbove ?? 4;
  const airSpeed = options.airSpeed ?? 8;
  const airLookahead = options.airLookahead ?? 8;
  const stuckFrames = options.stuckFrames ?? 45;
  const stuckSpeed = options.stuckSpeed ?? 1.5;
  const state: ChainState = { points: [], source: null, cursor: 0, sprinting: false, stuck: 0 };
  const target = { x: 0, y: 0, z: 0 };

  return (view: PilotView, out: PilotCommand): void => {
    if (view.frames !== state.source) rebuild(state, view.frames);
    out.moveX = 0;
    out.moveY = 1;
    out.pitch = 0;
    const { points } = state;
    if (points.length < 2) {
      out.buttons = 0;
      return;
    }

    let found = nearest(points, state.cursor - SEARCH_BEHIND, state.cursor + SEARCH_AHEAD, view.x, view.z);
    if (found.d2 > LOST_DISTANCE * LOST_DISTANCE) found = nearest(points, 0, points.length - 2, view.x, view.z);
    state.cursor = found.i;

    const a = points[found.i];
    const b = points[found.i + 1];
    const floorY = a.y + (b.y - a.y) * found.t;
    const airborne = view.y - floorY > dropAbove;

    walk(points, found.i, found.t, airborne ? airLookahead : lookahead, target);
    out.yaw = yawToward(target.x - view.x, target.z - view.z);

    if (state.sprinting) {
      if (view.stamina < sprintOff) state.sprinting = false;
    } else if (view.stamina > sprintOn) {
      state.sprinting = true;
    }
    if (airborne) {
      state.stuck = 0;
      out.moveY = view.speed < airSpeed ? 1 : 0;
      out.buttons = 0;
      return;
    }
    state.stuck = view.speed < stuckSpeed ? state.stuck + 1 : 0;
    let buttons = state.sprinting && view.speed < targetSpeed ? InputButton.SPRINT : 0;
    // Wedged on a step or a lip: a human jumps it. Held for a few frames, then released (the jump needs an edge).
    if (state.stuck > stuckFrames && (state.stuck - stuckFrames) % 30 < 6) buttons |= InputButton.JUMP;
    out.buttons = buttons;
  };
}

/** A centreline pilot over `run`. */
export function centrelinePilot(run: HeadlessRun, options: CentrelineOptions = {}): Pilot {
  return createPilot(run, 'centreline', centrelinePolicy(options));
}
