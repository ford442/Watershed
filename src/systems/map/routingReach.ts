/**
 * routingReach — the campaign chain as the 1D channel routing sees it.
 *
 * The SWE window is ~24 m of river; the basin upstream of it is the whole
 * campaign chain (glacial → lumber → meander → hydro → delta). The routing in
 * emscripten/routing.cpp reduces each segment of that chain to three numbers:
 *
 *   length  along the segment's Catmull-Rom centreline (m)
 *   slope   centreline drop over that length (m/m; the C++ clamps it, so a
 *           waterfall is steep, not a free fall)
 *   width   the authored `waterWidth` (m), before any forecast multiplier —
 *           the forecast is what the routing carries, not what shapes it
 *
 * Geometry comes from the treadmill's own generator (`buildProceduralSegment`
 * with the default base seed), walked map after map with continuity, so it is
 * deterministic and launch-hour independent. A `?seed=` run moves the path in
 * the world but not these statistics by much; the routing does not need the
 * exact spline, only its length and fall.
 *
 * Pure — no WASM, no React. The routing itself is never ported here.
 */
import type * as THREE from 'three';
import { buildCampaignStack } from '../../maps/campaign';
import { getMapDefinition, type MapRegistryId } from '../../maps/registry';
import { DEFAULT_MAP_CONFIG, ProceduralMapManager, buildProceduralSegment } from './MapSystem';

export interface RoutingSegmentRef {
  mapId: MapRegistryId;
  /** Segment index within that map (the treadmill's id). */
  index: number;
}

export interface RoutingReach {
  /** Chain order, head first. */
  mapIds: readonly MapRegistryId[];
  /** One entry per routed segment, head first. */
  segments: readonly RoutingSegmentRef[];
  lengths: Float32Array;
  slopes: Float32Array;
  widths: Float32Array;
}

/** Last authored segment index of a map — the chain hands off after it. */
function lastAuthoredIndex(mapId: MapRegistryId): number {
  const def = getMapDefinition(mapId);
  let last = def.startIndex;
  for (const seg of def.levelData.segments) last = Math.max(last, seg.index);
  return last;
}

/** Build the chain from `head` to the end of the campaign. */
export function buildRoutingReach(head: MapRegistryId = 'glacial'): RoutingReach {
  const mapIds = buildCampaignStack(head);
  const segments: RoutingSegmentRef[] = [];
  const lengths: number[] = [];
  const slopes: number[] = [];
  const widths: number[] = [];

  let previous: THREE.Vector3[] | null = null;
  for (const mapId of mapIds) {
    const def = getMapDefinition(mapId);
    const manager = new ProceduralMapManager(
      def.levelData,
      def.fallbackProgression,
      {},
      def.continuation ?? null,
    );
    const last = lastAuthoredIndex(mapId);
    for (let index = def.startIndex; index <= last; index += 1) {
      const { chunk, progression } = buildProceduralSegment(index, previous, manager, {
        baseSeed: DEFAULT_MAP_CONFIG.seed,
        ensureContinuity: previous !== null,
      });
      const points = chunk.pathPoints;
      const length = Math.max(chunk.length, 1);
      const drop = points[0].y - points[points.length - 1].y;
      segments.push({ mapId, index });
      lengths.push(length);
      slopes.push(drop / length);
      widths.push(progression.waterWidth ?? DEFAULT_MAP_CONFIG.waterWidth);
      previous = points;
    }
  }

  return {
    mapIds,
    segments,
    lengths: Float32Array.from(lengths),
    slopes: Float32Array.from(slopes),
    widths: Float32Array.from(widths),
  };
}

const reachCache = new Map<MapRegistryId, RoutingReach>();

/** `buildRoutingReach`, memoised per head — the geometry never changes in a session. */
export function getRoutingReach(head: MapRegistryId = 'glacial'): RoutingReach {
  let reach = reachCache.get(head);
  if (!reach) {
    reach = buildRoutingReach(head);
    reachCache.set(head, reach);
  }
  return reach;
}

/**
 * Chain position of a treadmill segment. Indices past a map's authored end
 * (procedural tail) clamp to its last routed segment, and before its start to
 * its first. Null when the map is not on the chain.
 */
export function routingChainIndex(
  reach: RoutingReach,
  mapId: MapRegistryId,
  segmentIndex: number,
): number | null {
  let first = -1;
  let lastPos = -1;
  for (let k = 0; k < reach.segments.length; k += 1) {
    const seg = reach.segments[k];
    if (seg.mapId !== mapId) continue;
    if (first < 0) first = k;
    lastPos = k;
    if (seg.index === segmentIndex) return k;
  }
  if (first < 0) return null;
  return segmentIndex < reach.segments[first].index ? first : lastPos;
}
