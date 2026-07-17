/**
 * meander_to_waterfall.ts
 *
 * Procedural fallback progression for indices beyond the authored JSON sequence
 * (see `meander_to_waterfall.json`). Segments 0–22 and the glacier prelude
 * (-3..-1) are authored in JSON; this table covers post-reach continuation.
 *
 * To swap maps without code edits, change `ACTIVE_MAP_ID` in `registry.ts`.
 */

import type { SegmentRange } from '../systems/MapSystem';

/** First segment ID of the early-game glacier/alpine prelude. */
export const GLACIER_START_INDEX = -3;

/** Start index for the toy delta map. */
export const DELTA_RAPIDS_CONTINUED_START_INDEX = 0;

/**
 * Procedural fallback once `meander_to_waterfall.json` segments are exhausted.
 * Ranges use "first match wins" semantics.
 */
export const MEANDER_FALLBACK_PROGRESSION: SegmentRange[] = [
  {
    indexFrom: 23,
    indexTo: 27,
    config: {
      biome: 'summer',
      type: 'normal',
      width: 28,
      waterWidth: 9,
      verticalBias: -1.5,
      meanderStrength: 0.6,
      flowSpeed: 1.4,
      treeDensity: 0.6,
      rockDensity: 'high',
    },
  },
  {
    indexFrom: 28,
    indexTo: 28,
    config: {
      biome: 'summer',
      type: 'normal',
      width: 22,
      waterWidth: 7,
      verticalBias: -2.2,
      meanderStrength: 0.1,
      flowSpeed: 1.5,
      rockDensity: 'high',
      cameraShake: 0.2,
    },
  },
  {
    indexFrom: 29,
    indexTo: 29,
    config: {
      biome: 'summer',
      type: 'waterfall',
      width: 40,
      waterWidth: 14,
      verticalBias: -3.0,
      meanderStrength: 0,
      forwardMomentum: 0.12,
      particleCount: 600,
      cameraShake: 0.7,
      flowSpeed: 2.0,
    },
  },
  {
    indexFrom: 30,
    indexTo: 30,
    config: {
      biome: 'autumn',
      type: 'splash',
      width: 75,
      waterWidth: 22,
      verticalBias: -0.1,
      meanderStrength: 0.4,
      flowSpeed: 0.25,
      treeDensity: 0.8,
      rockDensity: 'low',
    },
  },
  {
    indexFrom: 31,
    indexTo: 32,
    config: {
      biome: 'autumn',
      type: 'normal',
      width: 80,
      waterWidth: 20,
      verticalBias: -0.1,
      meanderStrength: 0.4,
      flowSpeed: 0.5,
      rockDensity: 'low',
      treeDensity: 0.5,
    },
  },
  {
    indexFrom: 33,
    indexTo: 34,
    config: {
      biome: 'delta',
      type: 'normal',
      width: 90,
      waterWidth: 30,
      verticalBias: 0,
      meanderStrength: 0.2,
      flowSpeed: 0.35,
      rockDensity: 'low',
      treeDensity: 0.6,
    },
  },
  {
    indexFrom: 35,
    indexTo: 36,
    config: {
      biome: 'delta',
      type: 'normal',
      width: 100,
      waterWidth: 35,
      verticalBias: 0,
      meanderStrength: 0.1,
      flowSpeed: 0.25,
      rockDensity: 'low',
      treeDensity: 0.4,
    },
  },
  {
    indexFrom: 37,
    indexTo: 37,
    config: {
      biome: 'delta',
      type: 'normal',
      width: 110,
      waterWidth: 38,
      verticalBias: 0,
      meanderStrength: 0.05,
      flowSpeed: 0.15,
      rockDensity: 'low',
      treeDensity: 0.3,
    },
  },
  {
    indexFrom: 38,
    indexTo: 38,
    config: {
      biome: 'delta',
      type: 'normal',
      width: 110,
      waterWidth: 38,
      verticalBias: 0,
      meanderStrength: 0,
      flowSpeed: 0.1,
      rockDensity: 'low',
      treeDensity: 0.2,
      journeyComplete: true,
    },
  },
];

/** @deprecated Use MEANDER_FALLBACK_PROGRESSION — kept for parity tests during migration. */
export const MEANDER_TO_WATERFALL_PROGRESSION = MEANDER_FALLBACK_PROGRESSION;

/** Delta map has no post-authored fallback — the JSON sequence is self-contained. */
export const DELTA_RAPIDS_CONTINUED_PROGRESSION: SegmentRange[] = [];
