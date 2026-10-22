/**
 * InputFrame.ts — the one per-frame input snapshot every vehicle reads (#486 A).
 *
 * One plain object, preallocated and mutated in place by the InputHub; readers
 * get it as `Readonly<InputFrame>`. Devices (keyboard/mouse today, gamepad and
 * touch in #486 B/C, a scripted source for headless runs) write per-device
 * scratch that the hub merges into this shape once per frame.
 *
 * Encoded layout (8 floats, `encodeInputFrame` / `decodeInputFrame`):
 *
 *   0 moveX    −1..1   strafe (A/D)
 *   1 moveY    −1..1   forward/back (W/S); right-click-forward lands here
 *   2 lookDX   px      mouse-equivalent pixels this frame (gamepad right stick, touch drag);
 *                      0 for the mouse itself — PointerLockControls owns that
 *   3 lookDY   px      as lookDX
 *   4 paddleL  0..1    Q
 *   5 paddleR  0..1    E
 *   6 buttons  integer bitfield stored in a float32 slot (≤ 24 bits, exact)
 *   7 dtMs     ms      the sim step this frame was produced for
 *
 * `tMs`, `frameIdx` and `source` are not encoded: `frameIdx` is the determinism
 * key and `tMs = frameIdx × dtMs`.
 */

/** Button bits. Integers in a float32 slot are exact up to 2^24, so ≤ 24 bits. */
export const InputButton = {
  JUMP: 1,
  SPRINT: 2,
  BRAKE: 4,
  DODGE: 8,
  INTERACT: 16,
  PAUSE: 32,
} as const;

export type InputButtonBit = (typeof InputButton)[keyof typeof InputButton];

/** Every defined bit. Anything outside this mask is dropped on encode. */
export const INPUT_BUTTON_MASK = 0x3f;

/** Widest bitfield a float32 slot carries exactly (2^24 − 1). */
export const INPUT_BUTTON_SLOT_MAX = 0xffffff;

/**
 * Bits a ghost / replay may carry. PAUSE is live (Phase C's on-screen button
 * needs somewhere to go) but a replay must never pause the viewer's game.
 */
export const GHOST_BUTTON_MASK = INPUT_BUTTON_MASK & ~InputButton.PAUSE;

/** Floats per encoded frame. */
export const INPUT_FRAME_FLOATS = 8;

/** Fixed sim step the hub is keyed to (1/60 s). */
export const INPUT_FIXED_DT_MS = 1000 / 60;

export type InputSourceId = 'none' | 'keyboard-mouse' | 'scripted' | 'gamepad' | 'touch';

export interface InputFrame {
  moveX: number;
  moveY: number;
  lookDX: number;
  lookDY: number;
  paddleL: number;
  paddleR: number;
  buttons: number;
  dtMs: number;
  /** `frameIdx × dtMs`; not encoded. */
  tMs: number;
  /** Monotonic hub tick counter; the determinism key. Not encoded. */
  frameIdx: number;
  /** Device that last moved the stick (last-active wins). Not encoded. */
  source: InputSourceId;
}

export function createInputFrame(): InputFrame {
  return {
    moveX: 0,
    moveY: 0,
    lookDX: 0,
    lookDY: 0,
    paddleL: 0,
    paddleR: 0,
    buttons: 0,
    dtMs: 0,
    tMs: 0,
    frameIdx: 0,
    source: 'none',
  };
}

/** Zero the encoded fields in place (identity and `source` are kept). */
export function clearInputFrame(frame: InputFrame): void {
  frame.moveX = 0;
  frame.moveY = 0;
  frame.lookDX = 0;
  frame.lookDY = 0;
  frame.paddleL = 0;
  frame.paddleR = 0;
  frame.buttons = 0;
  frame.dtMs = 0;
  frame.tMs = 0;
  frame.frameIdx = 0;
}

export function copyInputFrame(from: Readonly<InputFrame>, into: InputFrame): InputFrame {
  into.moveX = from.moveX;
  into.moveY = from.moveY;
  into.lookDX = from.lookDX;
  into.lookDY = from.lookDY;
  into.paddleL = from.paddleL;
  into.paddleR = from.paddleR;
  into.buttons = from.buttons;
  into.dtMs = from.dtMs;
  into.tMs = from.tMs;
  into.frameIdx = from.frameIdx;
  into.source = from.source;
  return into;
}

export function hasButton(frame: Readonly<InputFrame>, bit: InputButtonBit): boolean {
  return (frame.buttons & bit) !== 0;
}

/**
 * Write exactly 8 floats at `offset`. Allocates nothing. `buttonMask` defaults
 * to every defined bit; the ghost recorder passes GHOST_BUTTON_MASK.
 */
export function encodeInputFrame(
  frame: Readonly<InputFrame>,
  out: Float32Array,
  offset: number,
  buttonMask: number = INPUT_BUTTON_MASK,
): Float32Array {
  out[offset] = frame.moveX;
  out[offset + 1] = frame.moveY;
  out[offset + 2] = frame.lookDX;
  out[offset + 3] = frame.lookDY;
  out[offset + 4] = frame.paddleL;
  out[offset + 5] = frame.paddleR;
  out[offset + 6] = frame.buttons & buttonMask & INPUT_BUTTON_SLOT_MAX;
  out[offset + 7] = frame.dtMs;
  return out;
}

/** Read 8 floats at `offset` into `into`. Allocates nothing; non-encoded fields are left alone. */
export function decodeInputFrame(src: ArrayLike<number>, offset: number, into: InputFrame): InputFrame {
  into.moveX = src[offset];
  into.moveY = src[offset + 1];
  into.lookDX = src[offset + 2];
  into.lookDY = src[offset + 3];
  into.paddleL = src[offset + 4];
  into.paddleR = src[offset + 5];
  into.buttons = Math.round(src[offset + 6]) & INPUT_BUTTON_SLOT_MAX;
  into.dtMs = src[offset + 7];
  return into;
}
