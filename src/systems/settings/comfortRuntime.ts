/**
 * comfortRuntime.ts — the live, cached `ComfortEffective` (#486 D).
 *
 * Per-frame consumers (camera shake, FOV kick, post-processing) call
 * `getComfort()`: one preallocated object, recomputed only when a setting or the
 * OS `prefers-reduced-motion` flag changes — so a settings change applies live
 * with no React re-render and no per-frame allocation.
 */

import { useSettingsStore } from './useSettingsStore';
import { createComfortEffective, deriveComfortInto, type ComfortEffective } from './comfort';

const cache: ComfortEffective = createComfortEffective();
let osReduced = false;
let started = false;

function recompute(): void {
  const s = useSettingsStore.getState();
  deriveComfortInto(
    {
      fov: s.fov,
      fovKick: s.fovKick,
      cameraShake: s.cameraShake,
      speedEffects: s.speedEffects,
      vignetteStrength: s.vignetteStrength,
      reducedMotion: s.reducedMotion,
    },
    osReduced,
    cache,
  );
}

/** Subscribe once: store changes and the OS media query both re-derive the cache. */
function start(): void {
  if (started) return;
  started = true;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    osReduced = mql.matches;
    mql.addEventListener?.('change', (e) => {
      osReduced = e.matches;
      recompute();
    });
  }
  useSettingsStore.subscribe(recompute);
  recompute();
}

/** The effective comfort values. The same object every call — read it, do not keep a field. */
export function getComfort(): Readonly<ComfortEffective> {
  start();
  return cache;
}

/** The OS `prefers-reduced-motion: reduce` flag as last seen. */
export function getOsReducedMotion(): boolean {
  start();
  return osReduced;
}

/** Tests only: pretend the OS flag changed. */
export function setOsReducedMotionForTest(value: boolean): void {
  start();
  osReduced = value;
  recompute();
}
