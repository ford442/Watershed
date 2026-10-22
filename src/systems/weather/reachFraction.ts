/**
 * reachFraction.ts — how far down its map the player is, as a weather script reads it.
 *
 * 0 at the map's first authored segment, 1 past its last. Whole segments only:
 * a script step lands on the frame the treadmill reports the segment entered,
 * which is the same frame on every replay of the same inputs.
 */
import type { MapDefinition } from '../../maps/registry';
import { clamp01 } from '../../math/scalar';

const lastIndexCache = new WeakMap<MapDefinition, number>();

function lastAuthoredIndex(map: MapDefinition): number {
  let last = lastIndexCache.get(map);
  if (last === undefined) {
    last = map.startIndex;
    for (const seg of map.levelData.segments) last = Math.max(last, seg.index);
    lastIndexCache.set(map, last);
  }
  return last;
}

/** Map progress (0..1) at treadmill segment `segmentIndex`. */
export function mapReachFraction(map: MapDefinition, segmentIndex: number): number {
  const span = lastAuthoredIndex(map) - map.startIndex + 1;
  if (!(span > 0) || !Number.isFinite(segmentIndex)) return 0;
  return clamp01((segmentIndex - map.startIndex) / span);
}

/** The first treadmill segment at which map progress reaches `fraction` (inverse of mapReachFraction). */
export function segmentAtReachFraction(map: MapDefinition, fraction: number): number {
  const span = lastAuthoredIndex(map) - map.startIndex + 1;
  return map.startIndex + Math.ceil(clamp01(fraction) * span);
}
