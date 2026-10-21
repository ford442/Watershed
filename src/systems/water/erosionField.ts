/**
 * erosionField — the live segments' erosion planes, worked by the SWE field (#487 E).
 *
 * A segment registers its hull grid as built (the uneroded `SegmentBedGrid`)
 * when it mounts; each solver step the host hands the field to
 * `accumulateFieldErosion`, which integrates the shear under every registered
 * segment into its plane (terrain/erosion.ts). A segment's `version` bumps when
 * its plane has moved EROSION_REFRESH_MIN_DELTA since its last mesh and at least
 * EROSION_REFRESH_SECONDS of solver time have passed since that mesh — so the
 * floor, the trimesh and the bed refresh together, at most once every few
 * seconds, and on the solver clock (a replay refreshes on the same step).
 *
 * The plane outlives the mount: on unregister it goes to the persistence store
 * (`saveErosion`), keyed by map and segment index in grid space, and the next
 * mount of that segment — later today, or tomorrow's river — starts from it.
 */
import {
  accumulateErosion,
  EROSION_REFRESH_MIN_DELTA,
  EROSION_REFRESH_SECONDS,
  erosionPlaneDelta,
  erosionPlaneIsZero,
  erosionPlaneSize,
  type ErosionFieldView,
} from '../../terrain/erosion';
import type { SegmentBedGrid } from '../../terrain/segmentMeshBuild';

/** Where a segment's plane comes from and goes to; null = nothing persisted (tests, scripted runs). */
export interface ErosionStore {
  load(key: string, size: number): Float32Array | null;
  save(key: string, plane: Float32Array): void;
}

export interface SegmentErosion {
  readonly segmentId: number;
  /** Persistence key (`mapId:segmentIndex`), or null when this mount does not persist. */
  readonly key: string | null;
  /** The hull grid as built: where the plane's vertices sit. */
  readonly bed: SegmentBedGrid;
  /** E per hull vertex (terrain/erosion.ts). */
  readonly plane: Float32Array;
  /** Bumps when the meshes should be rebuilt from `plane`. */
  version: number;
  /** The plane the current meshes were built from. */
  applied: Float32Array;
  /** Solver time of the last bump. */
  appliedAt: number;
  /** The plane moved since it was loaded (save on unregister). */
  dirty: boolean;
}

const entries = new Map<number, SegmentErosion>();
const listeners = new Map<number, Set<() => void>>();
let store: ErosionStore | null = null;
/** Seconds of solver time integrated since the page loaded (the refresh clock). */
let solverTime = 0;

/** Install (or clear) the persistence backend; `useGeometries` mounts read it. */
export function setErosionStore(next: ErosionStore | null): void {
  store = next;
}

function notify(segmentId: number): void {
  for (const listener of listeners.get(segmentId) ?? []) listener();
}

/**
 * Register a mounted segment's hull grid. Starts from the stored plane for
 * `key` when one fits the grid. Replaces (and saves) any previous entry for
 * the id. Returns the entry; its `version` is 1 when it starts eroded.
 */
export function registerSegmentErosion(segmentId: number, bed: SegmentBedGrid, key: string | null): SegmentErosion {
  unregisterSegmentErosion(segmentId);
  const size = erosionPlaneSize(bed);
  const stored = key && store ? store.load(key, size) : null;
  const plane = stored && stored.length === size ? stored : new Float32Array(size);
  const entry: SegmentErosion = {
    segmentId,
    key,
    bed,
    plane,
    version: erosionPlaneIsZero(plane) ? 0 : 1,
    applied: plane.slice(),
    appliedAt: solverTime,
    dirty: false,
  };
  entries.set(segmentId, entry);
  return entry;
}

/** Drop a segment (it left the treadmill), persisting a plane the river moved. */
export function unregisterSegmentErosion(segmentId: number): void {
  const entry = entries.get(segmentId);
  if (!entry) return;
  entries.delete(segmentId);
  if (entry.dirty && entry.key && store) store.save(entry.key, entry.plane);
}

export function getSegmentErosion(segmentId: number): SegmentErosion | undefined {
  return entries.get(segmentId);
}

/** Subscribe to a segment's version bumps (useSyncExternalStore). */
export function subscribeSegmentErosion(segmentId: number, listener: () => void): () => void {
  let set = listeners.get(segmentId);
  if (!set) {
    set = new Set();
    listeners.set(segmentId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(segmentId);
  };
}

export function getSegmentErosionVersion(segmentId: number): number {
  return entries.get(segmentId)?.version ?? 0;
}

/**
 * One solver step of `dt` over every registered segment. Bumps (and notifies)
 * the segments whose floor is due a refresh. Returns how many bumped.
 */
export function accumulateFieldErosion(field: ErosionFieldView, dt: number): number {
  if (!(dt > 0)) return 0;
  solverTime += dt;
  const zMin = field.originZ;
  const zMax = field.originZ + (field.height - 1) * field.cellSize;
  let bumped = 0;
  for (const entry of entries.values()) {
    const rows = entry.bed.rows;
    const z0 = rows[2];
    const z1 = rows[rows.length - 1];
    if (Math.max(z0, z1) < zMin || Math.min(z0, z1) > zMax) continue;
    if (accumulateErosion(entry.plane, entry.bed, field, dt) > 0) entry.dirty = true;
    if (solverTime - entry.appliedAt < EROSION_REFRESH_SECONDS) continue;
    if (erosionPlaneDelta(entry.plane, entry.applied) < EROSION_REFRESH_MIN_DELTA) continue;
    entry.applied.set(entry.plane);
    entry.appliedAt = solverTime;
    entry.version += 1;
    bumped += 1;
    notify(entry.segmentId);
  }
  return bumped;
}

/** Persist every dirty plane now (run end / page hide); entries stay registered. */
export function flushErosion(): void {
  if (!store) return;
  for (const entry of entries.values()) {
    if (!entry.dirty || !entry.key) continue;
    store.save(entry.key, entry.plane);
    entry.dirty = false;
  }
}

/** Test seam. */
export function resetErosionFieldForTests(): void {
  entries.clear();
  listeners.clear();
  store = null;
  solverTime = 0;
}
