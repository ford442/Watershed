/**
 * bathymetrySampler — the segment hull → SWE bed field (`grid.b`).
 *
 * Phase 2 of #374 gave the solver a real bed; #487 C makes it the same surface
 * the raft collides with. Each live segment registers the hull grid its Rapier
 * trimesh was built from (`SegmentBedGrid`, from `buildSegmentMeshBuffers` on
 * the main thread or the sim worker), and the sampler interpolates the same
 * triangles, so the SWE bed and the trimesh floor agree to float rounding.
 * The canyon profile is evaluated once, by the terrain tile — there is no
 * second evaluation here.
 *
 * Convention (see `emscripten/swe.h`, do not drift from it):
 *   b is bed elevation above the channel-floor datum, `b = 0` meaning the full
 *   still-water depth H. Total depth is `H + eta - b`, so a cell is dry once
 *   `b > H + eta`.
 *
 * The water sheet hangs WATER_LEVEL above the path and the hull floor hangs
 * `floorHeight` above it, so the still depth is `WATER_LEVEL − floorHeight`
 * and, with H the solver's mean depth,
 *
 *   b = floorHeight − (WATER_LEVEL − H)        (one datum, every segment)
 *
 * A cell dries exactly where the floor rises through the water sheet. This
 * used to need a per-segment re-datum (`b = yHeight − yHeightAtChannelCentre`)
 * because the slot profile floated its floor ~4 m above the sheet; the slot
 * profile now sits on the shared datum (TERRAIN_SLOT_FLOOR_LIFT), so the bed is
 * continuous across segment joins too.
 */

import { WATER_LEVEL } from '../../constants/game';
import type { SegmentBedGrid } from '../../terrain/segmentMeshBuild';
import { SWE_MEAN_DEPTH } from './SWEHeightField';

/**
 * Bed height used where no segment covers a cell, and the ceiling every
 * sampled bank is clamped to. Comfortably above `H + eta` for any plausible
 * disturbance, so uncovered cells read as dry land rather than open water.
 */
export const BATHYMETRY_DRY_BED = SWE_MEAN_DEPTH + 2;

/** Deepest bed the sampler will emit (depth is capped at 2H in the thalweg). */
const MIN_BED = -SWE_MEAN_DEPTH;

/** Floor height above the path at which `b = 0` (still depth H under the water sheet). */
export const BED_DATUM = WATER_LEVEL - SWE_MEAN_DEPTH;

export interface BathymetrySource {
  segmentId: number;
  /** World-Z span this segment covers (min/max, direction-agnostic). */
  minZ: number;
  maxZ: number;
  /** Path midpoint used to place hydroEvents in world XZ. */
  centerX: number;
  centerZ: number;
  /**
   * Hull floor height above the (row-interpolated) path at world XZ, on the
   * trimesh's own triangles, or null if not covered.
   */
  sampleFloorHeight(worldX: number, worldZ: number): number | null;
  /** Bed elevation above the floor datum at world XZ, or null if not covered. */
  sampleBed(worldX: number, worldZ: number): number | null;
  /** The path (centreline) y the hull hangs from at world XZ, row-interpolated, or null if not covered. */
  samplePathY(worldX: number, worldZ: number): number | null;
}

/** Convert a hull floor height (above the path) to an SWE bed value. */
export function bedFromFloorHeight(floorHeight: number): number {
  const b = floorHeight - BED_DATUM;
  if (!Number.isFinite(b)) return BATHYMETRY_DRY_BED;
  return Math.min(BATHYMETRY_DRY_BED, Math.max(MIN_BED, b));
}

/**
 * A bathymetry source over a segment's hull grid.
 *
 * The hull's vertex (ix, iz) sits at `row[iz] + (x_ix, h, 0)` in world space,
 * so a quad is a parallelogram sheared along the path and its two triangles —
 * (a, b, d) and (b, c, d), PlaneGeometry's split — are affine images of the
 * unit square's halves. Interpolating `h` over them in grid coordinates is
 * therefore exactly the trimesh floor minus the path. Tube folds pull wall
 * vertices inward; the bed keeps the unfolded column positions, which only
 * differs above the corridor, where the bed is dry anyway.
 */
export function createSegmentBathymetrySource(
  segmentId: number,
  bed: SegmentBedGrid | null
): BathymetrySource | null {
  if (!bed) return null;
  const { segmentsX, segmentsZ, width, h, rows } = bed;
  const cols = segmentsX + 1;
  if (segmentsX < 1 || segmentsZ < 1 || h.length < cols * (segmentsZ + 1) || rows.length < (segmentsZ + 1) * 3) {
    return null;
  }
  for (let i = 0; i < rows.length; i += 1) if (!Number.isFinite(rows[i])) return null;

  const rowX = (iz: number) => rows[iz * 3];
  const rowZ = (iz: number) => rows[iz * 3 + 2];
  const first = rowZ(0);
  const last = rowZ(segmentsZ);
  if (first === last) return null;
  // Segments run downstream (−Z) but the sampler stays direction-agnostic.
  const descending = last < first;
  const minZ = Math.min(first, last);
  const maxZ = Math.max(first, last);
  const mid = Math.floor(segmentsZ / 2);
  const cellX = width / segmentsX;
  const halfWidth = width / 2;

  const rowY = (iz: number) => rows[iz * 3 + 1];
  // Scratch for `locate`: the quad and the point's place in it.
  const at = { iz: 0, fz: 0, ix: 0, fx: 0 };

  /** Fill `at` for world XZ; false when the segment does not cover it. */
  const locate = (worldX: number, worldZ: number): boolean => {
    if (!(worldZ >= minZ && worldZ <= maxZ)) return false;

    // Bracketing row pair by world Z.
    let iz = segmentsZ - 1;
    for (let i = 0; i < segmentsZ; i += 1) {
      const a = rowZ(i);
      const b = rowZ(i + 1);
      if (descending ? worldZ <= a && worldZ >= b : worldZ >= a && worldZ <= b) {
        iz = i;
        break;
      }
    }
    const zA = rowZ(iz);
    const span = rowZ(iz + 1) - zA;
    const fz = Math.abs(span) < 1e-9 ? 0 : Math.min(1, Math.max(0, (worldZ - zA) / span));

    // Column by the sheared x: the row origin moves linearly along the quad.
    const originX = rowX(iz) + (rowX(iz + 1) - rowX(iz)) * fz;
    const u = (worldX - originX + halfWidth) / cellX;
    if (!(u >= 0 && u <= segmentsX)) return false;
    at.iz = iz;
    at.fz = fz;
    at.ix = Math.min(segmentsX - 1, Math.floor(u));
    at.fx = u - at.ix;
    return true;
  };

  const sampleFloorHeight = (worldX: number, worldZ: number): number | null => {
    if (!locate(worldX, worldZ)) return null;
    const { iz, fz, ix, fx } = at;
    const ha = h[iz * cols + ix];
    const hd = h[iz * cols + ix + 1];
    const hb = h[(iz + 1) * cols + ix];
    const hc = h[(iz + 1) * cols + ix + 1];
    const y = fx + fz <= 1
      ? ha + (hd - ha) * fx + (hb - ha) * fz
      : hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
    return Number.isFinite(y) ? y : null;
  };

  const sampleBed = (worldX: number, worldZ: number): number | null => {
    const floor = sampleFloorHeight(worldX, worldZ);
    return floor === null ? null : bedFromFloorHeight(floor);
  };

  const samplePathY = (worldX: number, worldZ: number): number | null => {
    if (!locate(worldX, worldZ)) return null;
    const y = rowY(at.iz) + (rowY(at.iz + 1) - rowY(at.iz)) * at.fz;
    return Number.isFinite(y) ? y : null;
  };

  return { segmentId, minZ, maxZ, centerX: rowX(mid), centerZ: rowZ(mid), sampleFloorHeight, sampleBed, samplePathY };
}

// ---------------------------------------------------------------------------
// Live registry — the treadmill publishes here, WaterForceSystem consumes.
// ---------------------------------------------------------------------------

const sources = new Map<number, BathymetrySource>();
let revision = 0;

/**
 * Register (or replace) a segment's bathymetry. Keyed by segment ID, so a
 * treadmill slot recycling into a new segment replaces its own entry instead
 * of leaving the previous canyon behind.
 */
export function registerSegmentBathymetry(segmentId: number, source: BathymetrySource | null): void {
  if (!source) {
    unregisterSegmentBathymetry(segmentId);
    return;
  }
  sources.set(segmentId, source);
  revision += 1;
}

export function unregisterSegmentBathymetry(segmentId: number): void {
  if (sources.delete(segmentId)) revision += 1;
}

export function clearSegmentBathymetry(): void {
  if (sources.size === 0) return;
  sources.clear();
  revision += 1;
}

/**
 * World y of the still-water sheet over world XZ: the covering segment's path
 * y plus `sheetOffset` (the sheet hangs WATER_LEVEL above the path). The
 * centreline descends hundreds of metres over a map, so an absolute
 * `WATER_LEVEL` is never a body's water level. Where segments overlap (a
 * meander folding back) the lower sheet wins, as the deeper bed does in
 * `sampleBathymetryInto`. Null where no segment covers the point.
 */
export function sampleWaterSheetY(worldX: number, worldZ: number, sheetOffset: number = WATER_LEVEL): number | null {
  let best: number | null = null;
  for (const source of sources.values()) {
    if (!(worldZ >= source.minZ && worldZ <= source.maxZ)) continue;
    const y = source.samplePathY(worldX, worldZ);
    if (y !== null && (best === null || y < best)) best = y;
  }
  return best === null ? null : best + sheetOffset;
}

/** Bumps whenever the registered set changes — cheap "is my bed stale?" check. */
export function getBathymetryRevision(): number {
  return revision;
}

export function getRegisteredBathymetryCount(): number {
  return sources.size;
}

export function getRegisteredBathymetrySource(segmentId: number): BathymetrySource | undefined {
  return sources.get(segmentId);
}

/**
 * Rasterize the registered canyon floor onto an SWE bed field.
 *
 * Every cell is written, so a stale bed can never survive a refresh — the
 * treadmill recycling a slot cannot leak the previous canyon into the window.
 * Returns the number of cells that a segment actually covered.
 */
export function sampleBathymetryInto(
  target: Float32Array,
  originX: number,
  originZ: number,
  cellSize: number,
  width: number,
  height: number
): number {
  let covered = 0;
  const rowCandidates: BathymetrySource[] = [];

  for (let gz = 0; gz < height; gz += 1) {
    const worldZ = originZ + gz * cellSize;

    rowCandidates.length = 0;
    for (const source of sources.values()) {
      if (worldZ >= source.minZ && worldZ <= source.maxZ) rowCandidates.push(source);
    }

    for (let gx = 0; gx < width; gx += 1) {
      const idx = gz * width + gx;
      if (rowCandidates.length === 0) {
        target[idx] = BATHYMETRY_DRY_BED;
        continue;
      }

      const worldX = originX + gx * cellSize;
      let best: number | null = null;
      for (let i = 0; i < rowCandidates.length; i += 1) {
        const bed = rowCandidates[i].sampleBed(worldX, worldZ);
        // Overlapping segments at a meander: take the deepest, so the channel
        // stays continuous rather than being dammed by a neighbour's bank.
        if (bed !== null && (best === null || bed < best)) best = bed;
      }

      if (best === null) {
        target[idx] = BATHYMETRY_DRY_BED;
      } else {
        target[idx] = best;
        covered += 1;
      }
    }
  }

  return covered;
}
