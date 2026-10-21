/**
 * comfort.ts — comfort settings resolved to what the consumers apply (#486 D).
 *
 * Pure, so it is unit-tested without a GL context. The player's stored values
 * (FOV, shake %, speed effects, vignette, reduced-motion preference) go in; one
 * `ComfortEffective` comes out:
 *
 *   reduced motion ON   → shake 0, FOV kick 0, speed effects off
 *   reduced motion OFF  → the stored values, untouched
 *
 * Reduced motion is `'system'` by default — it follows the OS
 * `prefers-reduced-motion` flag — so a player who has the OS flag set gets a
 * calm game without opening Options, and can still say `'off'` to opt back in.
 */

/** Stored preference: follow the OS, or force on/off. */
export type ReducedMotionPref = 'system' | 'on' | 'off';

export const FOV_MIN = 70;
export const FOV_MAX = 110;
/** The camera FOV the game shipped with; also the default of the FOV setting. */
export const FOV_DEFAULT = 75;

export interface ComfortInput {
  /** Base vertical FOV, degrees. */
  fov: number;
  /** Sprint / speed FOV kick, 0..1 of the authored kick. */
  fovKick: number;
  /** Camera shake amplitude, 0..1. */
  cameraShake: number;
  /** Speed blur / chromatic aberration. */
  speedEffects: boolean;
  /** Vignette strength, 0..1 of the authored darkness. */
  vignetteStrength: number;
  reducedMotion: ReducedMotionPref;
}

export interface ComfortEffective {
  reducedMotion: boolean;
  fovBase: number;
  fovKick: number;
  shake: number;
  speedEffects: boolean;
  vignette: number;
}

export function clampFov(fov: number): number {
  return Math.max(FOV_MIN, Math.min(FOV_MAX, Number.isFinite(fov) ? fov : FOV_DEFAULT));
}

export function resolveReducedMotion(pref: ReducedMotionPref, osReduced: boolean): boolean {
  return pref === 'on' || (pref === 'system' && osReduced);
}

/** Resolve into `out` (allocation-free) — the runtime cache reuses one object. */
export function deriveComfortInto(input: ComfortInput, osReduced: boolean, out: ComfortEffective): ComfortEffective {
  const reduced = resolveReducedMotion(input.reducedMotion, osReduced);
  out.reducedMotion = reduced;
  out.fovBase = clampFov(input.fov);
  out.fovKick = reduced ? 0 : input.fovKick;
  out.shake = reduced ? 0 : input.cameraShake;
  out.speedEffects = reduced ? false : input.speedEffects;
  out.vignette = input.vignetteStrength;
  return out;
}

export function createComfortEffective(): ComfortEffective {
  return { reducedMotion: false, fovBase: FOV_DEFAULT, fovKick: 1, shake: 1, speedEffects: true, vignette: 1 };
}

export function deriveComfort(input: ComfortInput, osReduced: boolean): ComfortEffective {
  return deriveComfortInto(input, osReduced, createComfortEffective());
}

/** Runner FOV target: base, plus the authored speed kick (≤ 12°) and waterfall punch (10°), scaled by `fovKick`. */
export function runnerTargetFov(hSpeed: number, isWaterfallSeg: boolean, c: Readonly<ComfortEffective>): number {
  const kick = Math.min(12, hSpeed * 0.45) + (isWaterfallSeg ? 10 : 0);
  return c.fovBase + kick * c.fovKick;
}

/**
 * Raft FOV target: base plus the speed-scaled kick, capped at the authored
 * headroom (`maxKick` = FOV_MAX − FOV_BASE of the raft camera), scaled by `fovKick`.
 */
export function raftTargetFov(
  speed: number,
  speedReference: number,
  speedScale: number,
  maxKick: number,
  c: Readonly<ComfortEffective>,
): number {
  const kick = Math.min(maxKick, (speed / speedReference) * speedScale);
  return c.fovBase + kick * c.fovKick;
}
