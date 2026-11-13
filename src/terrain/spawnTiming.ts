import { queryFlags } from '../config/queryFlags';
import { traceName, traceRecording, traceSpanAt } from '../debug/trace/traceProbe';
/**
 * spawnTiming — user-timing measures around a treadmill segment's mount (#487 Phase B).
 *
 * Off unless the page was opened with `?spawnProfile=1`;
 * `verification/spawn_profile.mjs` reads the measures and attributes `longtask`
 * entries to the mounts they overlap. Two measures per segment, keyed by the
 * segment's path object (a recycled slot gets a new path):
 *
 *   segment-build  TrackSegment's own render: channel profile, placement, and
 *                  the canyon / collision / wall / water geometry
 *                  (`detail.geometryMs` is the geometry's share).
 *   segment-mount  The same start through TrackSegment's passive effect, which
 *                  React runs after every descendant's effects — so the whole
 *                  subtree's render, commit, and effects (Rapier collider
 *                  creation, decoration instancing) are inside it.
 *
 * While a trace records (#559 D) the same two spans land on the timeline's
 * `segments` track (their own row: a mount straddles frames), measured or not.
 */

export interface SpawnTimingDetail {
  segmentId: number;
  biome: string;
  /** Where the geometry came from: 'main' (TS on this thread) or 'worker' (a sim-worker tile). */
  source: 'main' | 'worker';
  /** The part of segment-build spent in useGeometries (0 when the tile came from the worker). */
  geometryMs: number;
}

const enabled =
  typeof performance !== 'undefined' &&
  typeof performance.measure === 'function' &&
  queryFlags().spawnProfile;

/**
 * True on a `?spawnProfile=1` page. LODManager then holds the preset it booted
 * with: the profile measures Medium and High, and on a software rasterizer the
 * adaptive ladder would otherwise walk both down to Low within seconds.
 */
export function spawnProfileEnabled(): boolean {
  return enabled;
}

interface Pending {
  start: number;
  detail: SpawnTimingDetail;
  mounted: boolean;
}

const pending = new WeakMap<object, Pending>();

const BUILD_SPAN = traceName('segment-build', 'segments');
const MOUNT_SPAN = traceName('segment-mount', 'segments');

const timing = () => enabled || traceRecording();

/** `performance.now()` when profiling or tracing, else 0 (no clock read on the hot path). */
export function spawnTimingStart(): number {
  return timing() ? performance.now() : 0;
}

/** After the render that built `key`'s geometry. Once per key. */
export function noteSegmentBuilt(key: object | null | undefined, start: number, detail: SpawnTimingDetail): void {
  if (!timing() || !key || start <= 0 || pending.has(key)) return;
  pending.set(key, { start, detail, mounted: false });
  const end = performance.now();
  if (enabled) performance.measure('segment-build', { start, end, detail });
  traceSpanAt(BUILD_SPAN, start, end);
}

/** From TrackSegment's passive effect, once the subtree for `key` committed. */
export function noteSegmentMounted(key: object | null | undefined): void {
  if (!timing() || !key) return;
  const entry = pending.get(key);
  if (!entry || entry.mounted) return;
  entry.mounted = true;
  const end = performance.now();
  if (enabled) performance.measure('segment-mount', { start: entry.start, end, detail: entry.detail });
  traceSpanAt(MOUNT_SPAN, entry.start, end);
}
