/**
 * scriptedRun.ts — `?input=script:<url>` / `?replay=<ghost>` mode and deterministic CI stepping (#486 A).
 *
 * With a script in the URL the Canvas boots `frameloop="never"` (App.tsx), and
 * the only thing that advances the sim is `stepScripted(n)`: n sim frames at
 * the fixed 1/60 s dt through R3F's `advance()` — hub tick, every useFrame
 * subscriber, the Rapier step — with the renderer stubbed out on all but the
 * last frame. Not rendering 59 of every 60 frames is what turns a ~40 s
 * SwiftShader run into seconds.
 *
 * Timestamps are sim time (`frame × dt`), never wall time, so two runs of one
 * script feed every subscriber the same deltas.
 *
 * The gameplay systems are not stepped here: `<SimCoreTick />` (a useFrame at
 * −90) feeds each frame's delta to SimCore, and for the length of a stepped run
 * the core is in scripted mode, where one frame is exactly one fixed step —
 * the same `simCore.step()` a real frame's accumulator calls.
 */

import type { RootState } from '@react-three/fiber';
import { INPUT_FIXED_DT_MS } from './InputFrame';
import { isGhostRecording } from '../systems/ghost/GhostRecorder';
import { simCore } from '../sim/core/SimCore';

const SCRIPT_PREFIX = 'script:';

/**
 * A hair over zero so the first frame's delta is dt + ε: Rapier's fixed-step
 * accumulator then steps exactly once per frame instead of skipping one on a
 * float round-down and doubling up the next.
 */
const ACCUMULATOR_BIAS_SEC = 1e-6;

/** `?input=script:<url>` → `<url>`, else null. */
export function getInputScriptUrl(search: string = typeof window !== 'undefined' ? window.location.search : ''): string | null {
  const value = new URLSearchParams(search).get('input');
  if (!value || !value.startsWith(SCRIPT_PREFIX)) return null;
  const url = value.slice(SCRIPT_PREFIX.length);
  return url.length > 0 ? url : null;
}

/**
 * `?replay=<ghost-url>` → the ghost file's URL, else null. Same-origin only
 * (like `?ghost=`): a replay plays a run's recorded inputs, so it must come
 * from where the game is served.
 */
export function getReplayGhostUrl(search: string = typeof window !== 'undefined' ? window.location.search : ''): string | null {
  const value = new URLSearchParams(search).get('replay');
  if (!value) return null;
  if (typeof window === 'undefined') return value;
  try {
    const url = new URL(value, window.location.href);
    return url.origin === window.location.origin ? url.href : null;
  } catch {
    return null;
  }
}

/** Boot-time and constant for the page: a scripted (or replay) page never takes keyboard play. */
export function isScriptedInputMode(search?: string): boolean {
  return getInputScriptUrl(search) !== null || getReplayGhostUrl(search) !== null;
}

/**
 * The run is live once the ghost recorder is running and the vehicle body
 * exists — the same clock the splits are read off. Script frame 0 is the
 * first sim frame for which this holds.
 */
export function isScriptedRunLive(vehicleBody: unknown): boolean {
  return isGhostRecording() && vehicleBody != null;
}

type Stepper = (n: number) => number;
let stepper: Stepper | null = null;
let simTimeSec = 0;

/** Registered by <InputHubTick /> from inside the Canvas. */
export function setScriptedStepper(next: Stepper | null): void {
  stepper = next;
}

/**
 * Advance `n` sim frames, rendering only the last. Returns frames advanced
 * (0 when no Canvas is up or the loop is not `frameloop="never"`).
 */
export function stepScripted(n: number): number {
  if (!stepper) return 0;
  return stepper(Math.max(0, Math.floor(n)));
}

/** The stepper body, given the live R3F root state. */
export function stepRootFrames(getState: () => RootState, n: number): number {
  const state = getState();
  if (state.frameloop !== 'never' || n <= 0) return 0;
  const gl = state.gl as unknown as { render: (...args: unknown[]) => unknown };
  const ownRender = Object.prototype.hasOwnProperty.call(gl, 'render');
  const render = gl.render;
  const skipRender = () => undefined;
  const dtSec = INPUT_FIXED_DT_MS / 1000;
  const wasScripted = simCore.isScripted();
  simCore.setScripted(true);
  try {
    for (let i = 0; i < n; i += 1) {
      gl.render = i === n - 1 ? render : skipRender;
      simTimeSec += dtSec;
      state.advance(simTimeSec + ACCUMULATOR_BIAS_SEC);
    }
  } finally {
    simCore.setScripted(wasScripted);
    if (ownRender) gl.render = render;
    else delete (gl as Partial<typeof gl>).render;
  }
  return n;
}

/** Sim seconds stepped so far on this page. */
export function getScriptedSimTimeSec(): number {
  return simTimeSec;
}
