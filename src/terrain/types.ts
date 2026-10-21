/**
 * terrain/types.ts — plain-data shapes shared by the terrain mirror, the sim
 * worker's mesh builders and the TrackSegment components (#503 E).
 *
 * Here, not in components/TrackSegment/types.ts, so terrain/ (worker-safe by
 * contract) imports nothing from components/.
 */

/**
 * Sampled channel cross-section along a segment path.
 * Produced by TrackSegment and consumed by geometry + placement hooks.
 */
export interface ChannelProfileSample {
  t: number;
  worldArc: number;
  leftHalfWidth: number;
  rightHalfWidth: number;
  corridorHalfWidth: number;
  floorDepth: number;
  floorWave: number;
  riffleStrength: number;
  gravelBarSide: 1 | -1;
  undercutSide: 1 | -1;
  flowScale: number;
}

/** Interpolated channel shape at a single path parameter t. */
export interface ChannelShape {
  leftHalfWidth: number;
  rightHalfWidth: number;
  corridorHalfWidth: number;
  floorDepth: number;
  floorWave: number;
  riffleStrength: number;
  gravelBarSide: 1 | -1;
  undercutSide: 1 | -1;
  flowScale: number;
}
