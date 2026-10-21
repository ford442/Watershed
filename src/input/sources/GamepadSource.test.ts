import { beforeEach, describe, expect, it } from 'vitest';
import { GamepadSource, getActivePadIndex } from './GamepadSource';
import {
  PadBindingTable,
  applyAxisDeadzone,
  applyRadialDeadzone,
  detectPadCapture,
  parsePadBinding,
  type PadLike,
} from './gamepadMapping';
import { InputHub } from '../InputHub';
import { InputButton } from '../InputFrame';
import { DEFAULT_PAD_BINDINGS, type Bindings } from '../../systems/settings/settingsDerive';

function makePad(over: { axes?: number[]; buttons?: Record<number, number>; mapping?: string; connected?: boolean } = {}): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const v = over.buttons?.[i] ?? 0;
    return { pressed: v > 0.5, value: v };
  });
  return { connected: over.connected ?? true, mapping: over.mapping ?? 'standard', axes: over.axes ?? [0, 0, 0, 0], buttons };
}

describe('radial dead zone + curve', () => {
  const out = { x: 0, y: 0 };

  it('is neutral inside the zone and rescales from the edge outward', () => {
    expect(applyRadialDeadzone(0.1, 0.1, 0.15, 1, out)).toEqual({ x: 0, y: 0 });
    applyRadialDeadzone(1, 0, 0.15, 1, out);
    expect(out.x).toBeCloseTo(1);
    applyRadialDeadzone(0.575, 0, 0.15, 1, out); // halfway between the zone edge and full
    expect(out.x).toBeCloseTo(0.5);
  });

  it('keeps the direction of a diagonal push (radial, not per-axis)', () => {
    applyRadialDeadzone(0.5, 0.25, 0.15, 1, out);
    expect(out.y / out.x).toBeCloseTo(0.5);
  });

  it('never exceeds 1 and applies the response exponent', () => {
    applyRadialDeadzone(2, 0, 0.1, 1, out);
    expect(out.x).toBeCloseTo(1);
    applyRadialDeadzone(0.55, 0, 0.1, 2, out); // (0.45/0.9)² = 0.25
    expect(out.x).toBeCloseTo(0.25);
  });

  it('shapes a single axis the same way, keeping the sign', () => {
    expect(applyAxisDeadzone(-0.05, 0.15, 1)).toBe(0);
    expect(applyAxisDeadzone(-1, 0.15, 1)).toBeCloseTo(-1);
  });
});

describe('pad binding parsing and capture', () => {
  it('parses buttons and signed axes, rejects junk', () => {
    expect(parsePadBinding({ kind: 'gamepad-button', code: 'Button5' })).toEqual({ axis: false, index: 5, sign: 0 });
    expect(parsePadBinding({ kind: 'gamepad-axis', code: 'Axis1-' })).toEqual({ axis: true, index: 1, sign: -1 });
    expect(parsePadBinding({ kind: 'gamepad-axis', code: 'Axis3+' })).toEqual({ axis: true, index: 3, sign: 1 });
    expect(parsePadBinding({ kind: 'gamepad-axis', code: 'Axis1' })).toBeNull();
    expect(parsePadBinding({ kind: 'gamepad-button', code: 'KeyW' })).toBeNull();
    expect(parsePadBinding({ kind: 'key', code: 'Button1' })).toBeNull();
  });

  it('the d-pad answers for a direction unless the player claimed that button', () => {
    const t = new PadBindingTable();
    t.sync(DEFAULT_PAD_BINDINGS);
    expect(t.dpad[0]).toBe(12); // forward
    const claimed: Bindings = { ...DEFAULT_PAD_BINDINGS, jump: { kind: 'gamepad-button', code: 'Button12' } };
    t.sync(claimed);
    expect(t.dpad[0]).toBe(-1);
  });

  it('captures the first non-reserved button or the first stick push away from rest', () => {
    expect(detectPadCapture(makePad({ buttons: { 3: 1 } }), null)).toEqual({ kind: 'gamepad-button', code: 'Button3' });
    // Start / triggers / back belong to the game.
    expect(detectPadCapture(makePad({ buttons: { 9: 1, 6: 1, 7: 1, 8: 1 } }), null)).toBeNull();
    expect(detectPadCapture(makePad({ axes: [0, -0.9, 0, 0] }), [0, 0, 0, 0])).toEqual({ kind: 'gamepad-axis', code: 'Axis1-' });
    // A resting stick that drifts is not a press.
    expect(detectPadCapture(makePad({ axes: [0.7, 0, 0, 0] }), [0.7, 0, 0, 0])).toBeNull();
  });
});

describe('GamepadSource', () => {
  let pad: PadLike;
  let hub: InputHub;
  let source: GamepadSource;
  let bindings: Bindings;
  const tuning = { deadzone: 0.15, curve: 1 };

  beforeEach(() => {
    pad = makePad();
    bindings = { ...DEFAULT_PAD_BINDINGS };
    hub = new InputHub();
    source = new GamepadSource(
      () => bindings,
      () => tuning,
      () => [pad],
    );
    source.attach(window);
    window.dispatchEvent(new Event('gamepadconnected'));
    hub.registerSource(source);
  });

  const tick = (n = 1) => {
    for (let i = 0; i < n; i += 1) hub.tick(1000 / 60, i + 1);
    return hub.readFrame();
  };

  it('reports nothing for a neutral pad and a pad inside the dead zone', () => {
    pad = makePad({ axes: [0.1, 0.1, 0.1, -0.1] });
    const f = tick();
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(0);
    expect(f.lookDX).toBe(0);
    expect(f.source).toBe('none');
  });

  it('left stick drives move (up = forward), right stick drives look', () => {
    pad = makePad({ axes: [0.7, -0.7, 0.5, 0.5] });
    const f = tick();
    expect(f.moveX).toBeGreaterThan(0.5);
    expect(f.moveY).toBeGreaterThan(0.5);
    expect(f.moveX).toBeCloseTo(-f.moveY * -1); // equal push on both axes stays diagonal
    expect(f.lookDX).toBeGreaterThan(0);
    expect(f.lookDY).toBeGreaterThan(0);
    expect(f.source).toBe('gamepad');
    expect(getActivePadIndex()).toBe(0);
  });

  it('look alone makes the gamepad the active source', () => {
    pad = makePad({ axes: [0, 0, 1, 0] });
    expect(tick().source).toBe('gamepad');
  });

  it('triggers are analog paddles, 0..1', () => {
    pad = makePad({ buttons: { 6: 0.3, 7: 1 } });
    const f = tick();
    expect(f.paddleL).toBeCloseTo(0.3);
    expect(f.paddleR).toBeCloseTo(1);
  });

  it('buttons map into the bitfield, including PAUSE and INTERACT', () => {
    pad = makePad({ buttons: { 0: 1, 5: 1, 4: 1, 2: 1, 3: 1, 9: 1 } });
    const b = tick().buttons;
    expect(b & InputButton.JUMP).toBeTruthy();
    expect(b & InputButton.SPRINT).toBeTruthy();
    expect(b & InputButton.BRAKE).toBeTruthy();
    expect(b & InputButton.DODGE).toBeTruthy();
    expect(b & InputButton.INTERACT).toBeTruthy();
    expect(b & InputButton.PAUSE).toBeTruthy();
  });

  it('the d-pad moves like the stick', () => {
    pad = makePad({ buttons: { 12: 1, 15: 1 } });
    const f = tick();
    expect(f.moveY).toBe(1);
    expect(f.moveX).toBe(1);
  });

  it('honours a rebound action: Jump on the right bumper', () => {
    bindings = { ...DEFAULT_PAD_BINDINGS, jump: { kind: 'gamepad-button', code: 'Button5' }, sprint: { kind: 'gamepad-button', code: 'Button0' } };
    pad = makePad({ buttons: { 5: 1 } });
    const b = tick().buttons;
    expect(b & InputButton.JUMP).toBeTruthy();
    expect(b & InputButton.SPRINT).toBe(0);
  });

  it('a movement action can be rebound to the other stick', () => {
    bindings = { ...DEFAULT_PAD_BINDINGS, forward: { kind: 'gamepad-axis', code: 'Axis3-' } };
    pad = makePad({ axes: [0, 0, 0, -1] });
    const f = tick();
    expect(f.moveY).toBeGreaterThan(0.9);
  });

  it('ignores non-standard mappings and disconnected pads', () => {
    pad = makePad({ axes: [1, 0, 0, 0], mapping: '' });
    expect(tick().moveX).toBe(0);
    pad = makePad({ axes: [1, 0, 0, 0], connected: false });
    expect(tick().moveX).toBe(0);
  });

  it('never touches getGamepads when nothing is connected', () => {
    let calls = 0;
    const idle = new GamepadSource(
      () => bindings,
      () => tuning,
      () => {
        calls += 1;
        return [pad];
      },
    );
    const h = new InputHub();
    h.registerSource(idle); // not attached, so no connected count
    h.tick(16, 1);
    expect(calls).toBe(0);
  });

  it('lets go of its listeners on dispose', () => {
    source.dispose();
    window.dispatchEvent(new Event('gamepadconnected'));
    pad = makePad({ axes: [1, 0, 0, 0] });
    expect(tick().moveX).toBe(0);
  });
});
