/**
 * runUntil.ts — drive a headless run with a pilot until something ends it (#556 C).
 *
 * Steps in 60-frame batches (`stepHeadless`'s browser-smoke cadence: React would commit treadmill
 * mounts between batches, so `commitEvery` defaults to 60 here too) and stops on the first of: the
 * map's end (`run.finish`), a wipeout, the caller's `until`, or `maxFrames`. A wipeout is observed
 * at the frame it flips, not at the batch's end (the runner step resets the body on the next
 * frame, so the end of the batch would read the respawn point): the position, segment and
 * why are the store's at that instant.
 */
import { useGameStore } from '../../../systems/GameState';
import type { SegmentEnvelope } from '../../../systems/map/segmentFrames';
import { getRecordedSplits } from '../../../systems/ghost/SplitRecorder';
import { resolveActiveEnvelopeInto } from '../../../vehicles/RunnerVehicle/hooks/runnerAirControl';
import type { HeadlessRun } from '../createHeadlessRun';
import { stepHeadless, type HeadlessInput } from '../stepHeadless';

export type WipeoutCause = 'above-envelope' | 'below-envelope' | 'other';

export interface WipeoutInfo {
  /** `run.clock.frame` when the flag flipped. */
  frame: number;
  segmentIndex: number;
  position: { x: number; y: number; z: number };
  /** The vertical envelope of the segment under the body: why an out-of-bounds wipeout fired. */
  envelope: { yMin: number; yMax: number; segmentIndex: number | null };
  /**
   * `above-envelope` / `below-envelope`: the lifecycle's out-of-bounds check (the body left the
   * segment's vertical band). `other`: the body was inside the band (an impact, a vortex…).
   */
  cause: WipeoutCause;
}

export interface RunUntilOptions {
  /** Hard cap on sim frames stepped by this call (a runaway guard: required). */
  maxFrames: number;
  /** Extra stop condition, checked after every batch. */
  until?: (run: HeadlessRun) => boolean;
  /** Frames per batch (default 60). */
  batch?: number;
  /** Passed to `stepHeadless` (default 60, the smokes' cadence). */
  commitEvery?: number;
}

export type StopReason = 'finished' | 'wipeout' | 'until' | 'maxFrames';

export interface RunResult {
  /** Why the call returned. */
  stop: StopReason;
  /** Sim frames stepped by this call (a wipeout stops at the batch the flip happened in). */
  frames: number;
  /** True when the treadmill reported the map's end. */
  finished: boolean;
  wipeout: WipeoutInfo | null;
  /** The recorded checkpoint splits so far: `[segmentIndex, tMs]`. */
  splits: Array<[number, number]>;
}

const scratchEnvelope: SegmentEnvelope = { yMin: 0, yMax: 0, segmentIndex: null, authored: false };

export function runUntil(run: HeadlessRun, input: HeadlessInput, options: RunUntilOptions): RunResult {
  const batch = Math.max(1, Math.floor(options.batch ?? 60));
  const commitEvery = options.commitEvery ?? 60;
  let wipeout: WipeoutInfo | null = null;

  // The flip is observed as it happens: the lifecycle check runs inside the step, before the
  // respawn the next frame applies, so the body is still where it left the band.
  const unsubscribe = useGameStore.subscribe((state, prev) => {
    if (wipeout || !state.isWipeout || prev.isWipeout) return;
    const p = run.body.translation();
    const pos = { x: p.x, y: p.y, z: p.z };
    const env = resolveActiveEnvelopeInto(scratchEnvelope, pos);
    wipeout = {
      frame: run.clock.frame,
      segmentIndex: state.currentSegmentIndex,
      position: pos,
      envelope: { yMin: env.yMin, yMax: env.yMax, segmentIndex: env.segmentIndex },
      cause: p.y > env.yMax ? 'above-envelope' : p.y < env.yMin ? 'below-envelope' : 'other',
    };
  });

  let frames = 0;
  let stop: StopReason = 'maxFrames';
  try {
    if (useGameStore.getState().isWipeout) {
      stop = 'wipeout';
    }
    while (stop === 'maxFrames' && frames < options.maxFrames) {
      const n = Math.min(batch, options.maxFrames - frames);
      frames += stepHeadless(run, n, input, { commitEvery });
      if (run.finish) stop = 'finished';
      else if (useGameStore.getState().isWipeout) stop = 'wipeout';
      else if (options.until?.(run)) stop = 'until';
    }
  } finally {
    unsubscribe();
  }
  if (wipeout === null && useGameStore.getState().isWipeout) {
    // Already wiped out on entry: no flip was seen, so say only what is known.
    const p = run.body.translation();
    wipeout = {
      frame: run.clock.frame,
      segmentIndex: useGameStore.getState().currentSegmentIndex,
      position: { x: p.x, y: p.y, z: p.z },
      envelope: { yMin: NaN, yMax: NaN, segmentIndex: null },
      cause: 'other',
    };
  }
  return {
    stop,
    frames,
    finished: run.finish !== null,
    wipeout,
    splits: getRecordedSplits().map((s) => [s.segmentIndex, s.tMs]),
  };
}
