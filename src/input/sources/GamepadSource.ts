/**
 * GamepadSource.ts — standard-mapping gamepad as an InputHub source (#486 B).
 *
 * Polled from `InputHub.tick`, never from events: the Gamepad API only reports
 * state by reading it. The one event use is `gamepadconnected` /
 * `gamepaddisconnected`, which only maintain a connected count so a machine
 * with no pad never calls `navigator.getGamepads()` at all.
 *
 *   left stick (axes 0/1)  → moveX / moveY  (radial dead zone + response curve)
 *   right stick (axes 2/3) → lookDX / lookDY (mouse-equivalent px this frame —
 *                            this is the first look source; PointerLockControls
 *                            stays for the mouse and the hub arbitrates by
 *                            last-active device)
 *   LT / RT (buttons 6/7)  → paddleL / paddleR, analog 0..1
 *   buttons                → the bitfield: the rebindable four from the pad
 *                            binding table, Y → INTERACT, Start → PAUSE
 *   d-pad                  → movement alternates unless the player claimed it
 *
 * Rebound axes/buttons come from `padBindings`; the table is rebuilt only when
 * that object changes. Dead zone and curve are read from settings every poll.
 *
 * Hot path (`poll`): indexed loops, preallocated scratch. The one allocation
 * left is the array `navigator.getGamepads()` itself returns.
 */

import { InputButton } from '../InputFrame';
import { setActivePadIndex } from '../activePad';
export { getActivePadIndex } from '../activePad';
import type { InputDeviceScratch, InputSource } from '../InputHub';
import { SETTINGS_ACTIONS, type Bindings } from '../../systems/settings/settingsDerive';
import {
  PAD_BUTTON,
  PAD_LOOK_PX_PER_S,
  PadBindingTable,
  applyAxisDeadzone,
  applyRadialDeadzone,
  padButton,
  type PadLike,
  type Stick,
} from './gamepadMapping';

export interface GamepadTuning {
  deadzone: number;
  curve: number;
}

const A_FORWARD = SETTINGS_ACTIONS.indexOf('forward');
const A_BACKWARD = SETTINGS_ACTIONS.indexOf('backward');
const A_LEFT = SETTINGS_ACTIONS.indexOf('leftward');
const A_RIGHT = SETTINGS_ACTIONS.indexOf('rightward');
const A_JUMP = SETTINGS_ACTIONS.indexOf('jump');
const A_SPRINT = SETTINGS_ACTIONS.indexOf('sprint');
const A_BRAKE = SETTINGS_ACTIONS.indexOf('brake');
const A_DODGE = SETTINGS_ACTIONS.indexOf('dodge');

export class GamepadSource implements InputSource {
  readonly id = 'gamepad' as const;

  private readonly table = new PadBindingTable();
  private readonly left: Stick = { x: 0, y: 0 };
  private readonly right: Stick = { x: 0, y: 0 };
  /** Shaped stick axes 0..3, so a rebound `Axis1-` reads the radial-processed value. */
  private readonly shaped = new Float32Array(4);
  private connected = 0;
  private target: Window | null = null;

  constructor(
    private readonly getBindings: () => Bindings,
    private readonly getTuning: () => GamepadTuning,
    private readonly getPads: () => ArrayLike<PadLike | null> = () => navigator.getGamepads(),
  ) {}

  attach(target: Window = window): void {
    if (this.target === target) return;
    this.detach();
    this.target = target;
    target.addEventListener('gamepadconnected', this.onConnected);
    target.addEventListener('gamepaddisconnected', this.onDisconnected);
    // A pad that was already connected before attach (page reload with the pad
    // awake) gets no connected event: count what is there now.
    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      const pads = this.getPads();
      let n = 0;
      for (let i = 0; i < pads.length; i += 1) if (pads[i]?.connected) n += 1;
      this.connected = n;
    }
  }

  detach(): void {
    const target = this.target;
    if (!target) return;
    target.removeEventListener('gamepadconnected', this.onConnected);
    target.removeEventListener('gamepaddisconnected', this.onDisconnected);
    this.target = null;
    this.connected = 0;
    setActivePadIndex(-1);
  }

  dispose(): void {
    this.detach();
  }

  poll(out: InputDeviceScratch, _frameIdx: number, dtMs: number): void {
    if (this.connected <= 0) return;
    const pads = this.getPads();
    const bindings = this.getBindings();
    this.table.sync(bindings);
    const tuning = this.getTuning();

    for (let p = 0; p < pads.length; p += 1) {
      const pad = pads[p];
      if (!pad || !pad.connected || pad.mapping !== 'standard') continue;
      if (this.readPad(pad, out, dtMs, tuning.deadzone, tuning.curve)) {
        setActivePadIndex(p);
        return;
      }
    }
  }

  /** Fill `out` from one pad; true when the pad is doing anything (so the first active pad wins). */
  private readPad(pad: PadLike, out: InputDeviceScratch, dtMs: number, dz: number, curve: number): boolean {
    const axes = pad.axes;
    const shaped = this.shaped;

    applyRadialDeadzone(axes[0] ?? 0, axes[1] ?? 0, dz, curve, this.left);
    applyRadialDeadzone(axes[2] ?? 0, axes[3] ?? 0, dz, curve, this.right);
    shaped[0] = this.left.x;
    shaped[1] = this.left.y;
    shaped[2] = this.right.x;
    shaped[3] = this.right.y;

    const forward = this.actionValue(pad, A_FORWARD, dz, curve);
    const backward = this.actionValue(pad, A_BACKWARD, dz, curve);
    const leftward = this.actionValue(pad, A_LEFT, dz, curve);
    const rightward = this.actionValue(pad, A_RIGHT, dz, curve);
    out.moveX = clampUnit(rightward - leftward);
    out.moveY = clampUnit(forward - backward);

    const lookScale = (PAD_LOOK_PX_PER_S * dtMs) / 1000;
    out.lookDX = this.right.x * lookScale;
    out.lookDY = this.right.y * lookScale;

    out.paddleL = padButton(pad, PAD_BUTTON.LT);
    out.paddleR = padButton(pad, PAD_BUTTON.RT);

    let buttons = 0;
    if (this.actionValue(pad, A_JUMP, dz, curve) > 0.5) buttons |= InputButton.JUMP;
    if (this.actionValue(pad, A_SPRINT, dz, curve) > 0.5) buttons |= InputButton.SPRINT;
    if (this.actionValue(pad, A_BRAKE, dz, curve) > 0.5) buttons |= InputButton.BRAKE;
    if (this.actionValue(pad, A_DODGE, dz, curve) > 0.5) buttons |= InputButton.DODGE;
    if (padButton(pad, PAD_BUTTON.Y) > 0.5) buttons |= InputButton.INTERACT;
    if (padButton(pad, PAD_BUTTON.START) > 0.5) buttons |= InputButton.PAUSE;
    out.buttons = buttons;

    return (
      out.moveX !== 0 ||
      out.moveY !== 0 ||
      out.lookDX !== 0 ||
      out.lookDY !== 0 ||
      out.paddleL > 0 ||
      out.paddleR > 0 ||
      buttons !== 0
    );
  }

  /** One action's analog value 0..1 from its bound input, or the d-pad alternate. */
  private actionValue(pad: PadLike, action: number, dz: number, curve: number): number {
    const t = this.table;
    let v = 0;
    const kind = t.kind[action];
    const index = t.index[action];
    if (kind === 1) {
      v = padButton(pad, index);
    } else if (kind === 2) {
      const raw = index < 4 ? this.shaped[index] : applyAxisDeadzone(pad.axes[index] ?? 0, dz, curve);
      const directed = raw * t.sign[action];
      v = directed > 0 ? directed : 0;
    }
    const dpad = t.dpad[action];
    if (dpad >= 0) {
      const d = padButton(pad, dpad);
      if (d > v) v = d;
    }
    return v;
  }

  private readonly onConnected = (): void => {
    this.connected += 1;
  };

  private readonly onDisconnected = (): void => {
    if (this.connected > 0) this.connected -= 1;
  };
}

function clampUnit(v: number): number {
  return v > 1 ? 1 : v < -1 ? -1 : v;
}
