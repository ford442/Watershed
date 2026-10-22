/**
 * ScriptedSource.ts — keyframed input for headless runs (`?input=script:<url>`, #486 A).
 *
 * Script format (parsed once at load):
 *
 *   { "version": 1, "dtMs": 16.6667, "headingYaw": 0,
 *     "frames": [[frameIdx, moveX, moveY, paddleL, paddleR, buttons], …] }
 *
 * A row may carry two more numbers, `[…, yaw, pitch]` (radians, YXZ): the
 * camera held for as long as that row is in force. `?replay=` scripts use it
 * to put a recorded runner's look back (the ghost's pose is its camera).
 *
 * Keyframes hold until the next one, so a 40 s run is a few dozen rows.
 * `headingYaw` (optional, radians, 0 = facing −Z / downstream) is an absolute
 * camera heading held for the whole run: movement is camera-relative and a
 * scripted run has no mouse look (no `lookDX` source in Phase A), while the
 * default camera spawns looking upstream at the origin.
 *
 * Pull model, sim-clocked: the source never reads wall time. Each hub tick it
 * reports the keyframe in force at its own script frame and advances by one.
 * Under SwiftShader at 5 FPS the run is slower in wall time and identical in
 * sim time. The script frame holds at 0 (neutral input) until `isLive()`
 * says the run has started, so script frame 0 is the first live sim frame.
 */

import { INPUT_BUTTON_MASK, INPUT_FIXED_DT_MS } from '../InputFrame';
import type { InputDeviceScratch, InputSource } from '../InputHub';

/** [frameIdx, moveX, moveY, paddleL, paddleR, buttons] or the same plus [yaw, pitch]. */
export type InputScriptRow =
  | [number, number, number, number, number, number]
  | [number, number, number, number, number, number, number, number];

export interface InputScript {
  version: 1;
  dtMs: number;
  /** Absolute camera yaw (radians, 0 = −Z) applied while the script is live; absent = leave the camera alone. */
  headingYaw?: number;
  frames: InputScriptRow[];
}

const clampAxis = (v: number, lo: number) => Math.max(lo, Math.min(1, v));

/** Validate and normalise a script (rows sorted by frameIdx). Throws on a malformed file. */
export function parseInputScript(raw: unknown): InputScript {
  if (!raw || typeof raw !== 'object') throw new Error('[ScriptedSource] script is not an object');
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) throw new Error(`[ScriptedSource] unsupported script version ${String(obj.version)}`);
  const dtMs = obj.dtMs === undefined ? INPUT_FIXED_DT_MS : Number(obj.dtMs);
  if (!Number.isFinite(dtMs) || dtMs <= 0) throw new Error('[ScriptedSource] dtMs must be a positive number');
  if (!Array.isArray(obj.frames) || obj.frames.length === 0) {
    throw new Error('[ScriptedSource] frames must be a non-empty array');
  }
  const frames: InputScriptRow[] = obj.frames.map((row, i) => {
    if (
      !Array.isArray(row) ||
      (row.length !== 6 && row.length !== 8) ||
      !row.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      throw new Error(`[ScriptedSource] frames[${i}] must be 6 (or 8, with yaw and pitch) finite numbers`);
    }
    const [frameIdx, moveX, moveY, paddleL, paddleR, buttons, yaw, pitch] = row as number[];
    if (!Number.isInteger(frameIdx) || frameIdx < 0) {
      throw new Error(`[ScriptedSource] frames[${i}] frameIdx must be a non-negative integer`);
    }
    const input: [number, number, number, number, number, number] = [
      frameIdx,
      clampAxis(moveX, -1),
      clampAxis(moveY, -1),
      clampAxis(paddleL, 0),
      clampAxis(paddleR, 0),
      Math.round(buttons) & INPUT_BUTTON_MASK,
    ];
    return row.length === 8 ? [...input, yaw, pitch] : input;
  });
  frames.sort((a, b) => a[0] - b[0]);
  let headingYaw: number | undefined;
  if (obj.headingYaw !== undefined) {
    headingYaw = Number(obj.headingYaw);
    if (!Number.isFinite(headingYaw)) throw new Error('[ScriptedSource] headingYaw must be a finite number');
  }
  return headingYaw === undefined ? { version: 1, dtMs, frames } : { version: 1, dtMs, headingYaw, frames };
}

export class ScriptedSource implements InputSource {
  readonly id = 'scripted' as const;

  /** Script frames consumed so far (the next poll reports this frame). */
  private scriptFrame = 0;
  /** Index of the keyframe in force at `scriptFrame`. */
  private row = 0;
  /** currentLook()'s answer, reused. */
  private readonly look: [number, number] = [0, 0];

  constructor(
    readonly script: InputScript,
    private readonly isLive: () => boolean,
  ) {}

  poll(out: InputDeviceScratch): void {
    if (!this.isLive()) return;
    const frames = this.script.frames;
    const f = this.scriptFrame;
    while (this.row + 1 < frames.length && frames[this.row + 1][0] <= f) this.row += 1;
    const k = frames[this.row];
    if (k[0] <= f) {
      out.moveX = k[1];
      out.moveY = k[2];
      out.paddleL = k[3];
      out.paddleR = k[4];
      out.buttons = k[5];
    }
    this.scriptFrame = f + 1;
  }

  /**
   * The camera `[yaw, pitch]` the row in force holds, or null when the row has
   * none (the script's `headingYaw`, if any, applies instead).
   */
  currentLook(): readonly [number, number] | null {
    const k = this.script.frames[this.row];
    if (!k || k.length !== 8) return null;
    this.look[0] = k[6];
    this.look[1] = k[7];
    return this.look;
  }

  /** Script frames played so far. */
  getScriptFrame(): number {
    return this.scriptFrame;
  }

  /** True once the run is live (the source is consuming script frames). */
  isRunning(): boolean {
    return this.isLive();
  }

  dispose(): void {}
}
