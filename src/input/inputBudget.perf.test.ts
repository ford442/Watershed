/**
 * Perf project (`pnpm test:perf`): wall-time and heap budgets run apart from
 * the correctness suite, with retries, because a loaded box fails them without
 * anything being wrong.
 *
 * The input budget (#486): hub + keyboard/mouse + gamepad + touch must cost
 * < 0.15 ms per frame and allocate nothing per frame. Timing in jsdom is a
 * ceiling check with generous headroom (the measured mean is in microseconds);
 * the allocation check watches heap growth across tens of thousands of ticks
 * with every source live and active.
 */
import { describe, expect, it } from 'vitest';
import { InputHub } from './InputHub';
import { KeyboardMouseSource } from './sources/KeyboardMouseSource';
import { GamepadSource } from './sources/GamepadSource';
import { TouchSource } from './sources/TouchSource';
import { DEFAULT_BINDINGS, DEFAULT_PAD_BINDINGS } from '../systems/settings/settingsDerive';
import type { PadLike } from './sources/gamepadMapping';

const BUDGET_MS = 0.15;

function buildRig() {
  const hub = new InputHub();

  const keys = { forward: true, jump: false } as Record<string, boolean>;
  const kbm = new KeyboardMouseSource(() => keys, () => DEFAULT_BINDINGS);
  hub.registerSource(kbm);

  // A live pad: stick pushed, trigger half pulled, A held.
  const pad: PadLike = {
    connected: true,
    mapping: 'standard',
    axes: [0.6, -0.8, 0.4, 0.2],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0, value: i === 6 ? 0.5 : i === 0 ? 1 : 0 })),
  };
  const tuning = { deadzone: 0.15, curve: 1.5 };
  const gamepad = new GamepadSource(() => DEFAULT_PAD_BINDINGS, () => tuning, () => [pad]);
  gamepad.attach(window);
  window.dispatchEvent(new Event('gamepadconnected'));
  hub.registerSource(gamepad);

  // A live thumb: stick planted and pushed, look finger dragging.
  const root = document.createElement('div');
  root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 800, width: 400, height: 800, x: 0, y: 0, toJSON: () => ({}) });
  document.body.appendChild(root);
  const touch = new TouchSource(() => ({ leftHanded: false, deadzone: 0.12, radius: 60 }));
  touch.attach(root);
  hub.registerSource(touch);
  const fire = (type: string, id: number, x: number, y: number) => {
    const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }) as MouseEvent & { pointerId: number };
    Object.defineProperty(ev, 'pointerId', { value: id });
    root.dispatchEvent(ev);
  };
  fire('pointerdown', 1, 100, 600);
  fire('pointermove', 1, 130, 560);
  fire('pointerdown', 2, 300, 400);

  return { hub, touch, fire, root, dispose: () => {
    touch.dispose();
    gamepad.dispose();
    kbm.dispose();
    root.remove();
  } };
}

describe('input budget', () => {
  it('hub + three sources tick in under 0.15 ms and settle to no growth', () => {
    const rig = buildRig();
    const { hub } = rig;
    const dt = 1000 / 60;

    // Warm the JIT and the one-time table builds.
    for (let i = 0; i < 3000; i += 1) hub.tick(dt, i + 1);

    const N = 60000;
    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) {
      // The look finger keeps dragging, so the touch source has fresh deltas every frame.
      if ((i & 7) === 0) rig.fire('pointermove', 2, 300 + (i % 40), 400 + (i % 24));
      hub.tick(dt, i + 3001);
    }
    const elapsed = performance.now() - t0;
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
    const meanMs = elapsed / N;

    console.info(`[input-budget] hub + 3 sources: ${(meanMs * 1000).toFixed(2)} µs/frame over ${N} ticks; heap growth ${(heapGrowth / 1024).toFixed(0)} KiB`);

    expect(hub.readFrame().source).not.toBe('none');
    expect(meanMs).toBeLessThan(BUDGET_MS);
    // 60k frames with a per-frame object/array would be tens of MB; a few MB of
    // unrelated test-runner churn is tolerated.
    expect(heapGrowth).toBeLessThan(8 * 1024 * 1024);
    // The hub's own meter agrees.
    expect(hub.getTickStats().meanMs).toBeLessThan(BUDGET_MS);
    rig.dispose();
  });
});
