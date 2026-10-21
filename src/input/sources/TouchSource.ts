/**
 * TouchSource.ts — on-screen controls as an InputHub source (#486 C).
 *
 * Pointer Events on the `<TouchControls />` layer, one pointer per role:
 *
 *   stick   the first finger down on the move half. The stick is floating — its
 *           origin is where the finger lands (kept inside the safe-area padding
 *           of the layer) — and pushing past `radius` saturates it. Radial dead
 *           zone, same maths as the gamepad. Up is forward.
 *   look    the first finger down on the other half. Its drag accumulates as
 *           mouse-equivalent pixels, paid out once per hub tick.
 *   button  any element with `data-touch="jump|sprint|pause|paddleL|paddleR"`.
 *           Held while its pointer is down.
 *
 * The halves swap for left-handed play. Every role takes its own pointer id via
 * `setPointerCapture`, so a thumb sliding off the stick keeps steering and a
 * second finger can look or jump at the same time. The layer sets
 * `touch-action: none` so the browser never scrolls, zooms or pulls to refresh.
 *
 * `poll` allocates nothing: it reads plain numbers the event handlers wrote.
 */

import { InputButton } from '../InputFrame';
import type { InputDeviceScratch, InputSource } from '../InputHub';
import { applyRadialDeadzone, type Stick } from './gamepadMapping';

export interface TouchTuning {
  /** Mirror the layout: stick on the right half, look on the left. */
  leftHanded: boolean;
  /** Stick dead zone, 0..1 of the radius. */
  deadzone: number;
  /** Stick radius in px. */
  radius: number;
}

type ButtonName = 'jump' | 'sprint' | 'pause' | 'paddleL' | 'paddleR';

/** Touch drag px → mouse-equivalent px. A thumb covers less distance than a wrist. */
export const TOUCH_LOOK_GAIN = 1.6;

export interface TouchStickVisual {
  active: boolean;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
}

const NO_POINTER = -1;

export class TouchSource implements InputSource {
  readonly id = 'touch' as const;

  private root: HTMLElement | null = null;

  private stickPointer = NO_POINTER;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private stickDX = 0;
  private stickDY = 0;
  private readonly shaped: Stick = { x: 0, y: 0 };
  private readonly visual: TouchStickVisual = { active: false, originX: 0, originY: 0, dx: 0, dy: 0 };

  private lookPointer = NO_POINTER;
  private lookLastX = 0;
  private lookLastY = 0;
  private lookAccX = 0;
  private lookAccY = 0;

  private jump = 0;
  private sprint = 0;
  private pause = 0;
  private paddleL = 0;
  private paddleR = 0;
  /** Which pointer holds which button, so a second finger releasing elsewhere does not unpress it. */
  private readonly buttonPointer: Record<ButtonName, number> = {
    jump: NO_POINTER,
    sprint: NO_POINTER,
    pause: NO_POINTER,
    paddleL: NO_POINTER,
    paddleR: NO_POINTER,
  };

  constructor(private readonly getTuning: () => TouchTuning) {}

  attach(root: HTMLElement): void {
    if (this.root === root) return;
    this.detach();
    this.root = root;
    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
    root.addEventListener('lostpointercapture', this.onUp);
  }

  detach(): void {
    const root = this.root;
    if (root) {
      root.removeEventListener('pointerdown', this.onDown);
      root.removeEventListener('pointermove', this.onMove);
      root.removeEventListener('pointerup', this.onUp);
      root.removeEventListener('pointercancel', this.onUp);
      root.removeEventListener('lostpointercapture', this.onUp);
    }
    this.root = null;
    this.releaseAll();
  }

  dispose(): void {
    this.detach();
  }

  /** Every finger up: nothing stays held when the layer unmounts or the game pauses. */
  /** For drawing the stick: where it was planted and how far the thumb has moved (px). Same object every call. */
  getStickVisual(): TouchStickVisual {
    const v = this.visual;
    v.active = this.stickPointer !== NO_POINTER;
    v.originX = this.stickOriginX;
    v.originY = this.stickOriginY;
    v.dx = this.stickDX;
    v.dy = this.stickDY;
    return v;
  }

  releaseAll(): void {
    this.stickPointer = NO_POINTER;
    this.stickDX = this.stickDY = 0;
    this.lookPointer = NO_POINTER;
    this.lookAccX = this.lookAccY = 0;
    this.jump = this.sprint = this.pause = this.paddleL = this.paddleR = 0;
    this.buttonPointer.jump = this.buttonPointer.sprint = this.buttonPointer.pause = NO_POINTER;
    this.buttonPointer.paddleL = this.buttonPointer.paddleR = NO_POINTER;
  }

  poll(out: InputDeviceScratch): void {
    const tuning = this.getTuning();
    if (this.stickPointer !== NO_POINTER) {
      const r = tuning.radius > 1 ? tuning.radius : 1;
      let x = this.stickDX / r;
      let y = this.stickDY / r;
      const m = Math.sqrt(x * x + y * y);
      if (m > 1) {
        x /= m;
        y /= m;
      }
      applyRadialDeadzone(x, y, tuning.deadzone, 1, this.shaped);
      out.moveX = this.shaped.x;
      out.moveY = -this.shaped.y; // screen y grows downward; up is forward
    }

    out.lookDX = this.lookAccX * TOUCH_LOOK_GAIN;
    out.lookDY = this.lookAccY * TOUCH_LOOK_GAIN;
    this.lookAccX = 0;
    this.lookAccY = 0;

    out.paddleL = this.paddleL;
    out.paddleR = this.paddleR;
    let buttons = 0;
    if (this.jump) buttons |= InputButton.JUMP;
    if (this.sprint) buttons |= InputButton.SPRINT;
    if (this.pause) buttons |= InputButton.PAUSE;
    out.buttons = buttons;
  }

  // --- pointer handlers ----------------------------------------------------

  private readonly onDown = (e: PointerEvent): void => {
    const root = this.root;
    if (!root) return;
    const target = e.target as Element | null;
    const button = target?.closest?.('[data-touch]')?.getAttribute('data-touch') as ButtonName | null | undefined;
    if (button && button in this.buttonPointer) {
      this.pressButton(button, e.pointerId, true);
      this.capture(e);
      e.preventDefault();
      return;
    }

    const tuning = this.getTuning();
    const rect = root.getBoundingClientRect();
    const onMoveHalf = (e.clientX < rect.left + rect.width / 2) !== tuning.leftHanded;
    if (onMoveHalf && this.stickPointer === NO_POINTER) {
      this.stickPointer = e.pointerId;
      // Floating origin, kept inside the layer's safe-area padding so the stick
      // never starts under a notch or a rounded corner.
      const style = getComputedStyle(root);
      const padL = parseFloat(style.paddingLeft) || 0;
      const padR = parseFloat(style.paddingRight) || 0;
      const padT = parseFloat(style.paddingTop) || 0;
      const padB = parseFloat(style.paddingBottom) || 0;
      this.stickOriginX = clamp(e.clientX, rect.left + padL + tuning.radius, rect.right - padR - tuning.radius);
      this.stickOriginY = clamp(e.clientY, rect.top + padT + tuning.radius, rect.bottom - padB - tuning.radius);
      this.stickDX = e.clientX - this.stickOriginX;
      this.stickDY = e.clientY - this.stickOriginY;
      this.capture(e);
      e.preventDefault();
    } else if (!onMoveHalf && this.lookPointer === NO_POINTER) {
      this.lookPointer = e.pointerId;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
      this.capture(e);
      e.preventDefault();
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickPointer) {
      this.stickDX = e.clientX - this.stickOriginX;
      this.stickDY = e.clientY - this.stickOriginY;
    } else if (e.pointerId === this.lookPointer) {
      this.lookAccX += e.clientX - this.lookLastX;
      this.lookAccY += e.clientY - this.lookLastY;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = NO_POINTER;
      this.stickDX = this.stickDY = 0;
    }
    if (e.pointerId === this.lookPointer) this.lookPointer = NO_POINTER;
    const names = Object.keys(this.buttonPointer) as ButtonName[];
    for (let i = 0; i < names.length; i += 1) {
      if (this.buttonPointer[names[i]] === e.pointerId) this.pressButton(names[i], e.pointerId, false);
    }
  };

  private pressButton(name: ButtonName, pointerId: number, down: boolean): void {
    this.buttonPointer[name] = down ? pointerId : NO_POINTER;
    const v = down ? 1 : 0;
    if (name === 'jump') this.jump = v;
    else if (name === 'sprint') this.sprint = v;
    else if (name === 'pause') this.pause = v;
    else if (name === 'paddleL') this.paddleL = v;
    else this.paddleR = v;
  }

  private capture(e: PointerEvent): void {
    try {
      (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      // A pointer that already ended cannot be captured; the move/up handlers cope.
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return v < lo ? lo : v > hi ? hi : v;
}
