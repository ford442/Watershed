import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInputFrame, hasButton, InputButton, type InputSourceId } from './InputFrame';
import { InputHub, useInputStore, type InputDeviceScratch, type InputSource } from './InputHub';
import { KeyboardMouseSource } from './sources/KeyboardMouseSource';
import { DEFAULT_BINDINGS, type Bindings } from '../systems/settings/settingsDerive';

const DT = 1000 / 60;

/** Test device whose next poll is whatever `next` says. */
class FakeSource implements InputSource {
  next: Partial<InputDeviceScratch> = {};
  disposed = 0;
  constructor(readonly id: InputSourceId) {}
  poll(out: InputDeviceScratch): void {
    Object.assign(out, this.next);
  }
  dispose(): void {
    this.disposed += 1;
  }
}

function keyEvent(type: 'keydown' | 'keyup', key: string): KeyboardEvent {
  return new KeyboardEvent(type, { key });
}

describe('InputHub', () => {
  let hub: InputHub;
  beforeEach(() => {
    hub = new InputHub();
  });
  afterEach(() => hub.reset());

  it('readFrame() returns one object identity across reads and ticks', () => {
    const a = new FakeSource('keyboard-mouse');
    hub.registerSource(a);
    a.next = { moveY: 1 };
    hub.tick(DT, 1);
    const first = hub.readFrame();
    expect(hub.readFrame()).toBe(first);
    expect(first.frameIdx).toBe(1);
    expect(first.moveY).toBe(1);
    hub.tick(DT, 2);
    expect(hub.readFrame()).toBe(first);
    expect(first.frameIdx).toBe(2);
    expect(first.tMs).toBeCloseTo(2 * DT);
  });

  it('clears per-device scratch every tick so a release is honoured', () => {
    const a = new FakeSource('keyboard-mouse');
    const b = new FakeSource('scripted');
    hub.registerSource(a);
    hub.registerSource(b);

    a.next = { buttons: InputButton.JUMP };
    b.next = { buttons: InputButton.SPRINT };
    hub.tick(DT, 1);
    expect(hub.readFrame().buttons).toBe(InputButton.JUMP | InputButton.SPRINT);

    // Device a releases; b keeps sprint held. OR-ing across ticks would keep JUMP.
    a.next = {};
    hub.tick(DT, 2);
    expect(hub.readFrame().buttons).toBe(InputButton.SPRINT);
  });

  it('gives the stick to the last-active device', () => {
    const a = new FakeSource('keyboard-mouse');
    const b = new FakeSource('scripted');
    hub.registerSource(a);
    hub.registerSource(b);

    a.next = { moveX: 1 };
    hub.tick(DT, 1);
    expect(hub.readFrame().moveX).toBe(1);
    expect(hub.readFrame().source).toBe('keyboard-mouse');

    // b moves while a is still held: a keeps the stick.
    b.next = { moveX: -1 };
    hub.tick(DT, 2);
    expect(hub.readFrame().moveX).toBe(1);

    // a goes neutral: b takes over.
    a.next = {};
    hub.tick(DT, 3);
    expect(hub.readFrame().moveX).toBe(-1);
    expect(hub.readFrame().source).toBe('scripted');
    expect(useInputStore.getState().activeSourceId).toBe('scripted');
  });

  it('re-registering an id disposes the old source (strict-mode double effect)', () => {
    const first = new FakeSource('keyboard-mouse');
    const second = new FakeSource('keyboard-mouse');
    hub.registerSource(first);
    hub.registerSource(second);
    expect(first.disposed).toBe(1);

    // The first effect's stale cleanup must not tear down its replacement.
    hub.unregisterSource('keyboard-mouse', first);
    expect(hub.hasSource('keyboard-mouse')).toBe(true);
    expect(second.disposed).toBe(0);

    hub.unregisterSource('keyboard-mouse', second);
    expect(hub.hasSource('keyboard-mouse')).toBe(false);
    expect(second.disposed).toBe(1);
  });

  it('publishes isScripted only, never the frame', () => {
    expect(useInputStore.getState().isScripted).toBe(false);
    hub.registerSource(new FakeSource('scripted'));
    expect(useInputStore.getState().isScripted).toBe(true);
    expect(Object.keys(useInputStore.getState()).sort()).toEqual(['activeSourceId', 'isScripted']);
    hub.unregisterSource('scripted');
    expect(useInputStore.getState().isScripted).toBe(false);
  });

  it('ghost latch ORs buttons, sums look and time-weights the axes', () => {
    const a = new FakeSource('keyboard-mouse');
    hub.registerSource(a);

    // 6 frames ≈ one 100 ms window: a 2-frame jump tap and forward for half of it.
    for (let i = 0; i < 6; i += 1) {
      a.next = {
        moveY: i < 3 ? 1 : 0,
        lookDX: 2,
        buttons: i === 1 || i === 2 ? InputButton.JUMP : 0,
      };
      hub.tick(DT, i + 1);
    }
    const into = createInputFrame();
    const out = hub.consumeGhostLatch(into);
    expect(out).toBe(into);
    expect(out).not.toBe(hub.readFrame());
    expect(hasButton(out, InputButton.JUMP)).toBe(true);
    expect(out.lookDX).toBe(12);
    expect(out.moveY).toBeCloseTo(0.5, 6);
    expect(out.dtMs).toBeCloseTo(6 * DT, 6);

    // Consuming resets the window.
    a.next = {};
    hub.tick(DT, 7);
    hub.consumeGhostLatch(into);
    expect(into.buttons).toBe(0);
    expect(into.moveY).toBe(0);
    expect(into.lookDX).toBe(0);
  });
});

describe('KeyboardMouseSource', () => {
  let keys: Record<string, boolean>;
  let bindings: Bindings;
  let hub: InputHub;
  let source: KeyboardMouseSource;

  beforeEach(() => {
    keys = {};
    bindings = { ...DEFAULT_BINDINGS };
    hub = new InputHub();
    source = new KeyboardMouseSource(() => keys, () => bindings);
  });
  afterEach(() => {
    source.detach();
    hub.reset();
  });

  it('has no side effects until attach(), and detach() removes every listener', () => {
    hub.registerSource(source);
    window.dispatchEvent(keyEvent('keydown', 'q'));
    hub.tick(DT, 1);
    expect(hub.readFrame().paddleL).toBe(0);

    source.attach(window);
    source.attach(window); // idempotent: no second listener set
    window.dispatchEvent(keyEvent('keydown', 'q'));
    hub.tick(DT, 2);
    expect(hub.readFrame().paddleL).toBe(1);

    source.detach();
    expect(source.isAttached()).toBe(false);
    window.dispatchEvent(keyEvent('keydown', 'e'));
    hub.tick(DT, 3);
    expect(hub.readFrame().paddleR).toBe(0);
    expect(hub.readFrame().paddleL).toBe(0);
  });

  it('maps drei keys to axes and button bits', () => {
    source.attach(window);
    hub.registerSource(source);

    keys.forward = true;
    keys.leftward = true;
    keys.jump = true;
    hub.tick(DT, 1);
    const f = hub.readFrame();
    expect(f.moveY).toBe(1);
    expect(f.moveX).toBe(-1);
    expect(hasButton(f, InputButton.JUMP)).toBe(true);

    keys.forward = false;
    keys.backward = true;
    keys.leftward = false;
    keys.rightward = true;
    keys.jump = false;
    hub.tick(DT, 2);
    expect(f.moveY).toBe(-1);
    expect(f.moveX).toBe(1);
    expect(f.buttons).toBe(0);
  });

  it('keeps the raw Shift/Alt fallbacks for sprint/dodge and Q/E paddles', () => {
    source.attach(window);
    hub.registerSource(source);
    window.dispatchEvent(keyEvent('keydown', 'Shift'));
    window.dispatchEvent(keyEvent('keydown', 'Alt'));
    window.dispatchEvent(keyEvent('keydown', 'E'));
    hub.tick(DT, 1);
    const f = hub.readFrame();
    expect(hasButton(f, InputButton.SPRINT)).toBe(true);
    expect(hasButton(f, InputButton.DODGE)).toBe(true);
    expect(f.paddleR).toBe(1);

    window.dispatchEvent(keyEvent('keyup', 'Shift'));
    window.dispatchEvent(keyEvent('keyup', 'Alt'));
    window.dispatchEvent(keyEvent('keyup', 'e'));
    hub.tick(DT, 2);
    expect(f.buttons).toBe(0);
    expect(f.paddleR).toBe(0);
  });

  it('drives a mouse-bound action (right-click-forward) and suppresses the context menu', () => {
    bindings = { ...bindings, forward: { kind: 'mouse', code: 'Mouse2' } };
    source.attach(window);
    hub.registerSource(source);

    window.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    hub.tick(DT, 1);
    expect(hub.readFrame().moveY).toBe(1);

    const menu = new MouseEvent('contextmenu', { cancelable: true });
    window.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);

    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    hub.tick(DT, 2);
    expect(hub.readFrame().moveY).toBe(0);

    // blur clears held mouse buttons.
    window.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    window.dispatchEvent(new Event('blur'));
    hub.tick(DT, 3);
    expect(hub.readFrame().moveY).toBe(0);
  });

  it('leaves the context menu alone when Mouse2 is not a binding', () => {
    source.attach(window);
    const menu = new MouseEvent('contextmenu', { cancelable: true });
    window.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });
});
