/**
 * hydro_dam.ts
 *
 * Authored industrial dam → stilling basin → vortex drain → outfall map.
 * Segments 0–15 are in `hydro_dam.json`; continuation into delta is handled
 * by MapRegistry `nextMapId` / continuation wiring.
 */

import type { SegmentRange } from '../systems/map/MapSystem';

/** First segment index of the hydro dam map. */
export const HYDRO_DAM_START_INDEX = 0;

/** Segment count of the authored hydro dam sequence. */
export const HYDRO_DAM_SEGMENT_COUNT = 16;

/** Stilling basin — wipeout / pipe respawn checkpoint anchor. */
export const HYDRO_DAM_BASIN_SEGMENT_INDEX = 4;

/** Vortex chamber set-piece (pond + drain suction). */
export const HYDRO_DAM_VORTEX_SEGMENT_INDEX = 5;

/** Drain tube entrance (steep suction corridor). */
export const HYDRO_DAM_DRAIN_SEGMENT_INDEX = 6;

/** Open-floor pipe drop — wipeout returns to basin. */
export const HYDRO_DAM_PIPE_SEGMENT_INDEX = 7;

/** Catwalk / gate segment — WashedOut forecast opens a gap. */
export const HYDRO_DAM_CATWALK_SEGMENT_INDEX = 12;

/**
 * Procedural fallback once hydro authored segments are exhausted.
 * Reuses the delta continued progression table.
 */
export { DELTA_RAPIDS_CONTINUED_PROGRESSION as HYDRO_DAM_FALLBACK_PROGRESSION } from './meander_to_waterfall';

/** Empty typed alias kept for tests that assert a fallback array exists. */
export const HYDRO_DAM_STANDALONE_FALLBACK: SegmentRange[] = [];
