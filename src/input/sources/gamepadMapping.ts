/**
 * gamepadMapping.ts — pure standard-mapping gamepad math (#486 B).
 *
 * Everything the GamepadSource decides, minus the `navigator.getGamepads()`
 * call, so the dead zone, response curve, binding lookup and rebind capture are
 * unit-tested with plain objects. Nothing here allocates: results go into
 * caller-owned out-parameters and the binding table is a set of fixed typed
 * arrays rebuilt only when the bindings object changes.
 */

import {
  DPAD_ALTERNATES,
  RESERVED_PAD_BUTTONS,
  SETTINGS_ACTIONS,
  type Binding,
  type Bindings,
} from '../../systems/settings/settingsDerive';

/** The slice of the Gamepad API the source reads (a real `Gamepad` satisfies it). */
export interface PadLike {
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: ArrayLike<number>;
  readonly buttons: ArrayLike<{ readonly pressed: boolean; readonly value: number }>;
}

export interface Stick {
  x: number;
  y: number;
}

/** Standard-mapping button indices the game owns. */
export const PAD_BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

/** Mouse-equivalent look speed at full right-stick deflection (px/s). 1100 px/s ≈ 2.2 rad/s at sensitivity 1. */
export const PAD_LOOK_PX_PER_S = 1100;

/** Axis magnitude that counts as a directional press in menus. */
export const MENU_AXIS_THRESHOLD = 0.6;

/**
 * Radial dead zone + response curve. Inside `deadzone` the stick is neutral;
 * outside, the magnitude is rescaled so the edge of the dead zone maps to 0
 * (no jump), raised to `curve` (1 = linear), and the direction is kept. This is
 * why the zone is radial: a per-axis zone turns a diagonal push into a snap
 * along one axis.
 */
export function applyRadialDeadzone(x: number, y: number, deadzone: number, curve: number, out: Stick): Stick {
  const m = Math.sqrt(x * x + y * y);
  if (!(m > deadzone) || m === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const span = 1 - deadzone;
  let scaled = span > 1e-6 ? (m - deadzone) / span : 1;
  if (scaled > 1) scaled = 1;
  if (curve !== 1) scaled = Math.pow(scaled, curve);
  const k = scaled / m;
  out.x = x * k;
  out.y = y * k;
  return out;
}

/** One-axis version of the same shaping, for non-stick axes. */
export function applyAxisDeadzone(v: number, deadzone: number, curve: number): number {
  const m = Math.abs(v);
  if (!(m > deadzone)) return 0;
  const span = 1 - deadzone;
  let scaled = span > 1e-6 ? (m - deadzone) / span : 1;
  if (scaled > 1) scaled = 1;
  if (curve !== 1) scaled = Math.pow(scaled, curve);
  return v < 0 ? -scaled : scaled;
}

const KIND_NONE = 0;
const KIND_BUTTON = 1;
const KIND_AXIS = 2;

/** Per-action lookup, parsed once per bindings object. */
export class PadBindingTable {
  readonly kind = new Uint8Array(SETTINGS_ACTIONS.length);
  readonly index = new Int8Array(SETTINGS_ACTIONS.length);
  /** +1 / −1 for axis bindings. */
  readonly sign = new Int8Array(SETTINGS_ACTIONS.length);
  /** d-pad button used as a fixed alternate when the player has not claimed it; −1 = none. */
  readonly dpad = new Int8Array(SETTINGS_ACTIONS.length);
  private source: Bindings | null = null;

  /** Rebuild only when the bindings object changed. Returns true when it did. */
  sync(bindings: Bindings): boolean {
    if (bindings === this.source) return false;
    this.source = bindings;
    const claimed = new Set<number>();
    for (let i = 0; i < SETTINGS_ACTIONS.length; i += 1) {
      const b = bindings[SETTINGS_ACTIONS[i]];
      const parsed = b ? parsePadBinding(b) : null;
      if (!parsed) {
        this.kind[i] = KIND_NONE;
        this.index[i] = -1;
        this.sign[i] = 0;
        continue;
      }
      this.kind[i] = parsed.axis ? KIND_AXIS : KIND_BUTTON;
      this.index[i] = parsed.index;
      this.sign[i] = parsed.sign;
      if (!parsed.axis) claimed.add(parsed.index);
    }
    for (let i = 0; i < SETTINGS_ACTIONS.length; i += 1) {
      const alt = DPAD_ALTERNATES[SETTINGS_ACTIONS[i]];
      this.dpad[i] = alt !== undefined && !claimed.has(alt) ? alt : -1;
    }
    return true;
  }
}

/** `Button5` → {axis:false,index:5}; `Axis1-` → {axis:true,index:1,sign:-1}; anything else → null. */
export function parsePadBinding(binding: Binding): { axis: boolean; index: number; sign: number } | null {
  const code = binding.code;
  if (binding.kind === 'gamepad-button' && code.startsWith('Button')) {
    const n = Number(code.slice(6));
    return Number.isInteger(n) && n >= 0 && n < 32 ? { axis: false, index: n, sign: 0 } : null;
  }
  if (binding.kind === 'gamepad-axis' && code.startsWith('Axis') && code.length >= 6) {
    const sign = code.charCodeAt(code.length - 1) === 45 ? -1 : code.charCodeAt(code.length - 1) === 43 ? 1 : 0;
    const n = Number(code.slice(4, -1));
    return sign !== 0 && Number.isInteger(n) && n >= 0 && n < 16 ? { axis: true, index: n, sign } : null;
  }
  return null;
}

/** Button value, 0..1 (analog triggers report `value`; digital buttons 0 or 1). */
export function padButton(pad: PadLike, i: number): number {
  const b = pad.buttons[i];
  if (!b) return 0;
  return b.value > 0 ? b.value : b.pressed ? 1 : 0;
}

/**
 * Next-input capture for the rebind UI: the first button pressed (that the game
 * does not own) or axis pushed past the threshold, as a Binding. `restBaseline`
 * holds the axis values at the moment capture began, so a drifting stick is not
 * captured; pass null to treat rest as 0.
 */
export function detectPadCapture(
  pad: PadLike,
  restBaseline: ArrayLike<number> | null,
  threshold: number = MENU_AXIS_THRESHOLD,
): Binding | null {
  for (let i = 0; i < pad.buttons.length; i += 1) {
    if (RESERVED_PAD_BUTTONS.has(i)) continue;
    if (pad.buttons[i].pressed) return { kind: 'gamepad-button', code: `Button${i}` };
  }
  for (let i = 0; i < pad.axes.length; i += 1) {
    const v = pad.axes[i] - (restBaseline ? restBaseline[i] ?? 0 : 0);
    if (v > threshold) return { kind: 'gamepad-axis', code: `Axis${i}+` };
    if (v < -threshold) return { kind: 'gamepad-axis', code: `Axis${i}-` };
  }
  return null;
}
