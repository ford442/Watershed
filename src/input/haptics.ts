/**
 * haptics.ts — the entry-chunk face of the gamepad rumble (#486 B).
 *
 * Collision, splash and wipeout code call `pulse(kind, scale)`; the envelopes,
 * the gate and the actuator handling live in `hapticsImpl.ts`, fetched the
 * first time a gamepad is the active device. For everyone else `pulse` is one
 * store read and a return — no rumble code is downloaded.
 */

import { lazyModule } from '../utils/lazyModule';
import { useInputStore } from './InputHub';

export type HapticKind = 'flow' | 'impact' | 'wipeout';

const impl = lazyModule(() => import('./hapticsImpl'));

/** Fetch the rumble code ahead of the first pulse (the hub calls this when a gamepad registers). */
export function preloadHaptics(): void {
  void impl.load().catch(() => undefined);
}

/** Play an envelope. `scale` 0..1 is how hard. False when nothing played (not a gamepad player, paused, off, not loaded yet). */
export function pulse(kind: HapticKind, scale: number = 1): boolean {
  if (useInputStore.getState().activeSourceId !== 'gamepad') return false;
  const m = impl.get();
  if (!m) {
    preloadHaptics();
    return false;
  }
  return m.pulse(kind, scale);
}

/** Stop any rumble now (pause, menu). A no-op until the rumble code has loaded. */
export function stopHaptics(): void {
  impl.get()?.stopHaptics();
}
