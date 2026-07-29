/**
 * glacial_source.ts
 *
 * Authored alpine prelude map. Segments 0–17 are in `glacial_source.json`;
 * continuation into `meander_to_waterfall.json` is handled by MapRegistry
 * continuation wiring (no TrackManager edits).
 */

import type { SegmentRange } from '../systems/MapSystem';

/** First segment index of the glacial source map. */
export const GLACIAL_SOURCE_START_INDEX = 0;

/** Segment count of the authored glacial prelude before meander handoff. */
export const GLACIAL_SOURCE_SEGMENT_COUNT = 18;

/**
 * Procedural fallback once glacial prelude + meander authored segments are exhausted.
 * Reuses the meander post-reach table.
 */
export { MEANDER_FALLBACK_PROGRESSION as GLACIAL_SOURCE_FALLBACK_PROGRESSION } from './meander_to_waterfall';
