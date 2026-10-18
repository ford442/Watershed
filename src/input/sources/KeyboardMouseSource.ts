/**
 * KeyboardMouseSource.ts — keyboard + mouse buttons as an InputHub source (#486 A).
 *
 * The body of the old usePlayerControls, lifted out of React:
 * - Rebindable keys come from drei's <KeyboardControls> store (`getKeys()`);
 *   the <KeyboardControls map> in Experience.tsx stays the keyboard listener.
 * - Raw Q/E (paddles) and Shift/Alt (legacy sprint/dodge fallbacks) are
 *   tracked with window key listeners, as before.
 * - Mouse buttons bound in settings (right-click-forward, …) are tracked as a
 *   bitmask; the context menu is suppressed while Mouse2 is a binding.
 *
 * Booleans become axes (`moveX = right − left`, `moveY = forward − back`) and
 * button bits. Look is not here — PointerLockControls owns it in Phase A.
 *
 * `attach()` / `detach()` are explicit; the constructor has no side effects.
 */

import { InputButton } from '../InputFrame';
import type { InputDeviceScratch, InputSource } from '../InputHub';
import { SETTINGS_ACTIONS, type Bindings, type SettingsAction } from '../../systems/settings/settingsDerive';

type KeyState = Partial<Record<string, boolean>>;

/** Per-action mouse button index (0..4), −1 when the action is not mouse-bound. */
interface MouseBindingTable {
  forward: number;
  backward: number;
  leftward: number;
  rightward: number;
  jump: number;
  sprint: number;
  brake: number;
  dodge: number;
}

function mouseCodeToButton(code: string): number {
  // Codes are 'Mouse0' | 'Mouse1' | 'Mouse2' | …
  const n = Number(code.slice(5));
  return Number.isInteger(n) && n >= 0 && n < 31 ? n : -1;
}

export class KeyboardMouseSource implements InputSource {
  readonly id = 'keyboard-mouse' as const;

  private q = false;
  private e = false;
  private shift = false;
  private alt = false;
  /** Bit n set while mouse button n is held. */
  private mouseMask = 0;

  private boundBindings: Bindings | null = null;
  private readonly mouseTable: MouseBindingTable = {
    forward: -1,
    backward: -1,
    leftward: -1,
    rightward: -1,
    jump: -1,
    sprint: -1,
    brake: -1,
    dodge: -1,
  };
  private mouse2Bound = false;

  private target: Window | null = null;

  constructor(
    private readonly getKeys: () => KeyState,
    private readonly getBindings: () => Bindings,
  ) {}

  attach(target: Window = window): void {
    if (this.target === target) return;
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('blur', this.onBlur);
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    const target = this.target;
    if (!target) return;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('mousedown', this.onMouseDown);
    target.removeEventListener('mouseup', this.onMouseUp);
    target.removeEventListener('blur', this.onBlur);
    target.removeEventListener('contextmenu', this.onContextMenu);
    this.target = null;
    this.q = this.e = this.shift = this.alt = false;
    this.mouseMask = 0;
  }

  isAttached(): boolean {
    return this.target !== null;
  }

  dispose(): void {
    this.detach();
  }

  poll(out: InputDeviceScratch): void {
    const keys = this.getKeys();
    let forward = keys.forward === true;
    let backward = keys.backward === true;
    let leftward = keys.leftward === true;
    let rightward = keys.rightward === true;
    let jump = keys.jump === true;
    // Sprint/dodge flow through the rebindable map; the raw Shift/Alt refs stay
    // as a fallback so held modifiers still register.
    let sprint = keys.sprint === true || this.shift;
    let brake = keys.brake === true;
    let dodge = keys.dodge === true || this.alt;

    const mask = this.mouseMask;
    if (mask !== 0) {
      this.syncMouseTable();
      const t = this.mouseTable;
      if (t.forward >= 0 && (mask & (1 << t.forward)) !== 0) forward = true;
      if (t.backward >= 0 && (mask & (1 << t.backward)) !== 0) backward = true;
      if (t.leftward >= 0 && (mask & (1 << t.leftward)) !== 0) leftward = true;
      if (t.rightward >= 0 && (mask & (1 << t.rightward)) !== 0) rightward = true;
      if (t.jump >= 0 && (mask & (1 << t.jump)) !== 0) jump = true;
      if (t.sprint >= 0 && (mask & (1 << t.sprint)) !== 0) sprint = true;
      if (t.brake >= 0 && (mask & (1 << t.brake)) !== 0) brake = true;
      if (t.dodge >= 0 && (mask & (1 << t.dodge)) !== 0) dodge = true;
    }

    out.moveX = (rightward ? 1 : 0) - (leftward ? 1 : 0);
    out.moveY = (forward ? 1 : 0) - (backward ? 1 : 0);
    out.paddleL = this.q ? 1 : 0;
    out.paddleR = this.e ? 1 : 0;
    let buttons = 0;
    if (jump) buttons |= InputButton.JUMP;
    if (sprint) buttons |= InputButton.SPRINT;
    if (brake) buttons |= InputButton.BRAKE;
    if (dodge) buttons |= InputButton.DODGE;
    out.buttons = buttons;
  }

  /** Rebuild the mouse lookup only when the bindings object changes. */
  private syncMouseTable(): void {
    const bindings = this.getBindings();
    if (bindings === this.boundBindings) return;
    this.boundBindings = bindings;
    const t = this.mouseTable as unknown as Record<SettingsAction, number>;
    let mouse2 = false;
    for (let i = 0; i < SETTINGS_ACTIONS.length; i += 1) {
      const action = SETTINGS_ACTIONS[i];
      const b = bindings[action];
      const button = b && b.kind === 'mouse' ? mouseCodeToButton(b.code) : -1;
      t[action] = button;
      if (button === 2) mouse2 = true;
    }
    this.mouse2Bound = mouse2;
  }

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    this.setRawKey(ev.key, true);
  };

  private readonly onKeyUp = (ev: KeyboardEvent): void => {
    this.setRawKey(ev.key, false);
  };

  private setRawKey(rawKey: string | undefined, down: boolean): void {
    const key = (rawKey ?? '').toLowerCase();
    if (key === 'q') this.q = down;
    else if (key === 'e') this.e = down;
    else if (key === 'shift') this.shift = down;
    else if (key === 'alt') this.alt = down;
  }

  private readonly onMouseDown = (ev: MouseEvent): void => {
    if (ev.button >= 0 && ev.button < 31) this.mouseMask |= 1 << ev.button;
  };

  private readonly onMouseUp = (ev: MouseEvent): void => {
    if (ev.button >= 0 && ev.button < 31) this.mouseMask &= ~(1 << ev.button);
  };

  private readonly onBlur = (): void => {
    this.mouseMask = 0;
  };

  private readonly onContextMenu = (ev: MouseEvent): void => {
    this.syncMouseTable();
    if (this.mouse2Bound) ev.preventDefault();
  };
}
