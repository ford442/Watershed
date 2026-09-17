/**
 * sweSwirl — one owner for the water-surface swirl, same rule as the impulses.
 *
 * `FlowingWater` has taken `vortexCenter` / `vortexRadius` / `vortexIntensity`
 * since the hydro chamber landed, but the intensity came from
 * `effectiveVortexStrength(forecastState, flowSpeed)` — a second vortex model,
 * authored separately from the one the hull actually feels, painted on top of
 * it. On a release hour the segment's `hydroEvents[]` vortex is already sinking
 * η and spinning `u,w` in the SWE field (`HYDRO_VORTEX_SINK`), so the swirl and
 * the eye foam should read *that*, not a parallel forecast curve.
 *
 * This is the visual half of the authority `VortexForceSystem` already applies
 * to Rapier impulses (#397): where a live SWE vortex owns the segment, nothing
 * else gets to describe the same water.
 *
 * Pure — no Three.js — so the choice is unit-testable without a canvas.
 */

import { eventsActiveAtHour, HYDRO_VORTEX_SINK, type HydroEvent } from './hydroEvents';

/**
 * Shader intensity per unit of η sink rate. Calibrated so the hydro chamber's
 * authored `strength: 4.2` reads as a full-strength drain (1.0) and a weaker
 * authored vortex reads proportionally softer.
 */
export const SWE_SWIRL_GAIN = 0.68;

/** Ceiling, so an over-authored strength cannot smear the whole surface. */
export const SWE_SWIRL_MAX = 1.5;

export type SwirlSource = 'swe' | 'authored' | 'none';

export interface SurfaceSwirl {
  /** Which model described this water. */
  source: SwirlSource;
  /** Curve parameter of the swirl centre, or null when there is no swirl. */
  centerT: number | null;
  /** Across-channel offset of the centre, metres. */
  lateralOffset: number;
  /** Influence radius, metres. */
  radius: number;
  /** Shader swirl / eye-foam intensity. 0 disables the term. */
  intensity: number;
}

const NO_SWIRL: SurfaceSwirl = {
  source: 'none',
  centerT: null,
  lateralOffset: 0,
  radius: 0,
  intensity: 0,
};

/** η sink rate → shader intensity. */
export function sweSwirlIntensity(strength: number): number {
  if (!Number.isFinite(strength) || strength <= 0) return 0;
  return Math.min(SWE_SWIRL_MAX, strength * HYDRO_VORTEX_SINK * SWE_SWIRL_GAIN);
}

/** Strongest live `vortex` event on a segment, or null. */
export function liveSweVortex(
  events: readonly HydroEvent[] | undefined,
  hour: number,
  segmentIndex: number,
): HydroEvent | null {
  let best: HydroEvent | null = null;
  for (const event of eventsActiveAtHour(events, hour)) {
    if (event.kind !== 'vortex' || event.segmentIndex !== segmentIndex) continue;
    if (!best || (event.strength ?? 1) > (best.strength ?? 1)) best = event;
  }
  return best;
}

export interface SurfaceSwirlInput {
  segmentIndex: number;
  hour: number;
  events?: readonly HydroEvent[];
  /** Authored `config.vortex`, used only when no SWE vortex is live here. */
  authored?: { centerT?: number; lateralOffset?: number; radius: number } | null;
  /**
   * Forecast-gated strength for the authored fallback — normally
   * `effectiveVortexStrength(segmentState, flowSpeed)`.
   */
  authoredIntensity?: number;
}

/**
 * Resolve the swirl one segment's water surface should draw.
 *
 * A live SWE vortex wins outright. Outside its hours the authored drain is
 * still a real field (VortexForceSystem is applying its impulses), so it keeps
 * its forecast-driven swirl — the two never describe the same water at once.
 */
export function resolveSurfaceSwirl(input: SurfaceSwirlInput): SurfaceSwirl {
  const live = liveSweVortex(input.events, input.hour, input.segmentIndex);

  if (live) {
    const intensity = sweSwirlIntensity(live.strength ?? 1);
    return {
      source: 'swe',
      centerT: live.centerT ?? 0.55,
      lateralOffset: live.lateralOffset ?? 0,
      radius: live.radius ?? 8,
      intensity,
    };
  }

  const authored = input.authored;
  if (!authored) return { ...NO_SWIRL };

  const intensity = Number.isFinite(input.authoredIntensity)
    ? Math.max(0, input.authoredIntensity as number)
    : 0;

  return {
    source: 'authored',
    centerT: authored.centerT ?? 0.55,
    lateralOffset: authored.lateralOffset ?? 0,
    radius: authored.radius,
    intensity,
  };
}

/**
 * Intensity at which the SWE eye-foam reads on its own.
 *
 * `FlowingWater` draws the drain from `vortexIntensity`: a swirl in the UVs and
 * a foam eye over the sink. Once that term is this strong the surface already
 * says "there is a hole in the water here", and the `VortexVisual` particle
 * ring on top of it is a second, coarser drawing of the same event — the exact
 * stacking this issue exists to remove, one layer up from the Rapier impulses.
 */
export const SWE_FOAM_READS = 0.34;

/** Ring opacity when nothing else is describing the water (authored drain). */
export const VORTEX_RING_OPACITY = 0.6;

/** Particle count for a ring that is carrying the swirl on its own. */
export const VORTEX_RING_PARTICLES = 56;

export interface VortexDecoration {
  /** Whether to mount `VortexVisual` at all. */
  visible: boolean;
  /** Ring opacity, 0–`VORTEX_RING_OPACITY`. */
  opacity: number;
  /** Instance count for the ring. */
  particleCount: number;
}

const NO_DECORATION: VortexDecoration = { visible: false, opacity: 0, particleCount: 0 };

/**
 * Decide what the particle ring does over a resolved swirl.
 *
 * - `authored` — the shader term is a forecast curve with no field behind it,
 *   so the ring is the readable part. Unchanged from before #399.
 * - `swe` — the foam is reading the η sink the hull is actually falling into.
 *   Below `SWE_FOAM_READS` the ring stays as a faint locator for a weak drain,
 *   fading out as the foam takes over; at or above it the ring is gone.
 * - `none` — nothing to draw.
 */
export function resolveVortexDecoration(swirl: SurfaceSwirl): VortexDecoration {
  if (swirl.intensity <= 0 || swirl.centerT === null) return { ...NO_DECORATION };

  if (swirl.source === 'authored') {
    return {
      visible: true,
      opacity: VORTEX_RING_OPACITY,
      particleCount: VORTEX_RING_PARTICLES,
    };
  }

  if (swirl.source !== 'swe') return { ...NO_DECORATION };

  const fade = 1 - Math.min(1, swirl.intensity / SWE_FOAM_READS);
  if (fade <= 0) return { ...NO_DECORATION };

  return {
    visible: true,
    opacity: VORTEX_RING_OPACITY * fade,
    particleCount: VORTEX_RING_PARTICLES,
  };
}
