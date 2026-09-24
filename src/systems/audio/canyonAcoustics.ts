/**
 * canyonAcoustics.ts — wall geometry → acoustic routing parameters.
 *
 * `AudioManager.enableCanyonAcoustics` used to put a lowpass and a fully-wet
 * convolver in series on every routed layer: a slot canyon and a summer
 * meander differed only in filter numbers, and nothing reflected. This maps
 * the biome's `wallTightness` (TrackBiomes.ts) plus a wall-surface wetness to
 * a *send* topology instead:
 *
 *   dry ─ lowpass ────────────────────────────┐
 *   ├─ convolver (short synthetic IR) × reverbSend ┤→ out
 *   └─ early-reflection taps × erSend (rapids only)┘
 *
 * Early reflections are what make a space read as enclosed: close walls give
 * short, dense, strong slaps; wet ice and concrete reflect more (and brighter)
 * than dry sandstone. An open reach (delta) gets no taps at all.
 *
 * No Web Audio imports — AudioManager builds the nodes, this only decides.
 */

import type { BiomeId } from '../../configs/biomes';

/** Below this wall tightness a reach is open water — acoustics stay off. */
export const OPEN_WALL_TIGHTNESS = 0.35;

/**
 * How reflective the wall surface is, 0 (absorbent) – 1 (wet ice / concrete).
 * "Wet" in the acoustic sense: a glazed surface returns more energy, and more
 * of the top end, than a dry porous one.
 */
const WALL_WETNESS: Partial<Record<BiomeId, number>> = {
  glacialMelt: 0.9,
  glacier: 0.85,
  cavern: 0.75,
  hydroDam: 0.7,
  lumberFlume: 0.55,
  canyonSummer: 0.45,
  alpineSpring: 0.45,
  canyonAutumn: 0.45,
  midnightMist: 0.5,
  delta: 0.4,
  slotCanyon: 0.3,
};

export const DEFAULT_WALL_WETNESS = 0.5;

export function wallWetnessForBiome(biome: string): number {
  return WALL_WETNESS[biome as BiomeId] ?? DEFAULT_WALL_WETNESS;
}

export interface EarlyReflectionTap {
  delaySeconds: number;
  gain: number;
}

export interface CanyonAcousticParams {
  /** 0 = open reach, 1 = fully enclosed. */
  enclosure: number;
  lowpassHz: number;
  lowpassQ: number;
  reverbDecaySeconds: number;
  /** Convolver return level mixed against a unity dry path. */
  reverbSend: number;
  /** Early-reflection bus level; 0 means build no taps. */
  earlyReflectionSend: number;
  /** Lowpass on the reflection bus — the walls' absorption. */
  earlyReflectionLowpassHz: number;
  taps: EarlyReflectionTap[];
}

/** Tap spacing relative to the first reflection — deliberately non-harmonic. */
const TAP_RATIOS = [1, 1.37, 1.83, 2.41, 3.05, 3.9];

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function canyonAcousticParams(
  wallTightness: number,
  wallWetness: number = DEFAULT_WALL_WETNESS,
): CanyonAcousticParams {
  const t = clamp01(wallTightness);
  const wet = clamp01(wallWetness);
  // Smoothstep from the open threshold to a slot canyon's 0.8.
  const x = clamp01((t - 0.3) / 0.5);
  const enclosure = x * x * (3 - 2 * x);

  // Kept from the original mapping so the dry colour of a routed layer does
  // not change under anyone who tuned against it.
  const lowpassHz = 6000 - t * 2000;
  const lowpassQ = 0.5 + t * 2.0;
  const reverbDecaySeconds = 0.3 + t * 0.5;
  const reverbSend = 0.1 + 0.3 * enclosure;

  const earlyReflectionSend = enclosure * (0.3 + 0.45 * wet);
  // Close walls → the first slap arrives sooner (≈45 ms open → ≈9 ms slot).
  const first = 0.045 + (0.009 - 0.045) * enclosure;
  const reflectivity = 0.35 + 0.5 * wet;
  const taps =
    earlyReflectionSend > 1e-3
      ? TAP_RATIOS.map((ratio, k) => ({
          delaySeconds: first * ratio,
          gain: Math.pow(reflectivity, k + 1),
        }))
      : [];

  return {
    enclosure,
    lowpassHz,
    lowpassQ,
    reverbDecaySeconds,
    reverbSend,
    earlyReflectionSend,
    earlyReflectionLowpassHz: 2500 + 5000 * wet,
    taps,
  };
}

/** Whether a wall profile should switch canyon acoustics on at all. */
export function isEnclosedReach(wallTightness: number): boolean {
  return Number.isFinite(wallTightness) && wallTightness >= OPEN_WALL_TIGHTNESS;
}
