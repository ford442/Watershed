/**
 * lumber_flume.ts
 *
 * Authored forest → elevated flume → gap jump map.
 * Segments 0–15 are in `lumber_flume.json`; continuation into
 * `meander_to_waterfall.json` is handled by MapRegistry continuation wiring.
 */

import type { SegmentRange } from '../systems/MapSystem';

/** First segment index of the lumber flume map. */
export const LUMBER_FLUME_START_INDEX = 0;

/** Segment count of the authored lumber flume sequence before meander handoff. */
export const LUMBER_FLUME_SEGMENT_COUNT = 16;

/** Gap / launch set-piece segment index (open-floor waterfall + launch shelf). */
export const LUMBER_FLUME_GAP_SEGMENT_INDEX = 10;

/** Splash landing pool immediately after the gap. */
export const LUMBER_FLUME_LANDING_SEGMENT_INDEX = 11;

/**
 * Procedural fallback once lumber flume + meander authored segments are exhausted.
 * Reuses the meander post-reach table.
 */
export { MEANDER_FALLBACK_PROGRESSION as LUMBER_FLUME_FALLBACK_PROGRESSION } from './meander_to_waterfall';

/** Empty typed alias kept for tests that assert a fallback array exists. */
export const LUMBER_FLUME_STANDALONE_FALLBACK: SegmentRange[] = [];
