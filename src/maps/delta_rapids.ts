/**
 * delta_rapids.ts
 *
 * Sunset raft finale — canyon opens into a wide braided delta, then beach landing.
 * Segments 0–21 live in `delta_rapids.json`. No post-authored fallback; JSON is
 * self-contained (campaign terminal map).
 */

import type { SegmentRange } from '../systems/map/MapSystem';

/** First segment index of the delta climax map. */
export const DELTA_RAPIDS_START_INDEX = 0;

/** Authored segment count (indices 0 … COUNT-1). */
export const DELTA_RAPIDS_SEGMENT_COUNT = 22;

/** Segment where runner→raft swap is forced (sky opens / wide water). */
export const DELTA_RAFT_SWAP_SEGMENT_INDEX = 2;

/** Mid-delta braided washout with forecast-washable side bridge. */
export const DELTA_BRAID_WASH_SEGMENT_INDEX = 11;

/** Beach landing / journey-complete segment. */
export const DELTA_BEACH_SEGMENT_INDEX = 21;

/** Open-water visual-smoke beat (wide pond channel). */
export const DELTA_OPEN_WATER_SEGMENT_INDEX = 6;

/**
 * Procedural fallback once authored delta segments are exhausted.
 * Empty by design — journeyComplete fires on the beach segment.
 */
export const DELTA_RAPIDS_FALLBACK_PROGRESSION: SegmentRange[] = [];

/** @deprecated Prefer DELTA_RAPIDS_START_INDEX — kept for hydro continuation imports. */
export const DELTA_RAPIDS_CONTINUED_START_INDEX = DELTA_RAPIDS_START_INDEX;

/** @deprecated Prefer DELTA_RAPIDS_FALLBACK_PROGRESSION. */
export const DELTA_RAPIDS_CONTINUED_PROGRESSION = DELTA_RAPIDS_FALLBACK_PROGRESSION;
