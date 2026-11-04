/**
 * glacial_source.ts
 *
 * Authored alpine prelude map. Segments 0–17 are in `glacial_source.json`;
 * continuation into `lumber_flume.json` is handled by MapRegistry
 * continuation wiring (no TrackManager edits).
 */

/** First segment index of the glacial source map. */
export const GLACIAL_SOURCE_START_INDEX = 0;

/**
 * Procedural fallback once glacial prelude + meander authored segments are exhausted.
 * Reuses the meander post-reach table.
 */
export { MEANDER_FALLBACK_PROGRESSION as GLACIAL_SOURCE_FALLBACK_PROGRESSION } from './meander_to_waterfall';
