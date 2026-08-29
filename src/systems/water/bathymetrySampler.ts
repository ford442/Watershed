/**
 * bathymetrySampler — canyon floor → SWE bed field (`grid.b`).
 *
 * Phase 2 of #374. The nonlinear solver has taken a bed elevation field since
 * ABI 6, but nothing ever wrote it: every biome simulated a flat rectangle.
 * This module closes that gap without a new dependency and without touching
 * Rapier — the collision canyon is an analytic U-profile
 * (`computeCanyonFloorHeight`), so the live treadmill registers its build
 * inputs here and the sampler evaluates the same profile straight onto the
 * player-centred SWE grid.
 *
 * Convention (see `emscripten/swe.h`, do not drift from it):
 *   b is bed elevation above the channel-floor datum, `b = 0` meaning the full
 *   still-water depth H. Total depth is `H + eta - b`, so a cell is dry once
 *   `b > H + eta`.
 *
 * The canyon builders express the floor as `yHeight`, an offset from the
 * segment path point. That offset carries a large per-biome constant — a slot
 * canyon's floor sits ~3.9 above its path point where a summer canyon's sits
 * near 0 — so it cannot be compared against `WATER_LEVEL` directly without
 * declaring the whole slot canyon dry. Each segment is therefore re-datumed
 * against its own thalweg: the channel-centre floor height at mid-segment maps
 * to `b = 0` (full still depth H), and every lateral rise above it shallows
 * the simulated depth by the same amount the authored canyon rises.
 *
 *   b = yHeight - yHeightAtChannelCentre
 *
 * So the shape of the canyon reaches the solver, not the biome's arbitrary
 * vertical offset: a slot canyon dries out a couple of metres off-centre, a
 * delta stays wet across the window.
 */

import * as THREE from 'three';
import {
  computeCanyonFloorHeight,
  type GeometryBuildContext,
} from '../../components/TrackSegment/hooks/geometryBuilders';
import { SWE_MEAN_DEPTH } from './SWEHeightField';

/** Centerline samples per segment used to invert world Z → curve parameter. */
const CENTERLINE_SAMPLES = 24;

/**
 * Bed height used where no segment covers a cell, and the ceiling every
 * sampled bank is clamped to. Comfortably above `H + eta` for any plausible
 * disturbance, so uncovered cells read as dry land rather than open water.
 */
export const BATHYMETRY_DRY_BED = SWE_MEAN_DEPTH + 2;

/** Deepest bed the sampler will emit (depth is capped at 2H in the thalweg). */
const MIN_BED = -SWE_MEAN_DEPTH;

export interface BathymetrySource {
  segmentId: number;
  /** World-Z span this segment covers (min/max, direction-agnostic). */
  minZ: number;
  maxZ: number;
  /** Path midpoint used to place hydroEvents in world XZ. */
  centerX: number;
  centerZ: number;
  /** Bed elevation above the floor datum at world XZ, or null if not covered. */
  sampleBed(worldX: number, worldZ: number): number | null;
}

/**
 * Convert a canyon `yHeight` to an SWE bed value, relative to that segment's
 * own thalweg reference (see the module header).
 */
export function bedFromFloorHeight(yHeight: number, floorReference: number): number {
  const b = yHeight - floorReference;
  if (!Number.isFinite(b)) return BATHYMETRY_DRY_BED;
  return THREE.MathUtils.clamp(b, MIN_BED, BATHYMETRY_DRY_BED);
}

/**
 * Build a bathymetry source from the same context the canyon meshes are built
 * from. Rock noise is excluded, matching `buildCollisionGeometry` — the SWE
 * grid is coarser than the noise wavelength anyway.
 */
export function createSegmentBathymetrySource(
  ctx: GeometryBuildContext
): BathymetrySource | null {
  const { segmentPath, segmentId, canyonWidth, waterWidth, channelProfile, isSlotCanyon } = ctx;
  const len = segmentPath?.getLength?.();
  if (!segmentPath || !len || !Number.isFinite(len) || len <= 0) return null;

  // Sample the centerline once. `buildCanyonGeometry` places every vertex at
  // `path(t).z`, so world Z alone identifies t and the centerline X offset.
  const ts: number[] = [];
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < CENTERLINE_SAMPLES; i += 1) {
    const t = i / (CENTERLINE_SAMPLES - 1);
    const p = segmentPath.getPoint(t);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
    ts.push(t);
    xs.push(p.x);
    zs.push(p.z);
  }

  const first = zs[0];
  const last = zs[zs.length - 1];
  // Segments run downstream (−Z) but the sampler stays direction-agnostic.
  const descending = last < first;
  const minZ = Math.min(first, last);
  const maxZ = Math.max(first, last);
  const mid = Math.floor(CENTERLINE_SAMPLES / 2);
  const centerX = xs[mid] ?? xs[0];
  const centerZ = zs[mid] ?? first;
  const halfWidth = canyonWidth * 0.5;

  // Thalweg reference: the channel-centre floor at mid-segment. Sampled once,
  // so the whole segment shares one datum and the lateral profile survives.
  const floorReference = computeCanyonFloorHeight(
    0,
    0,
    len,
    canyonWidth,
    waterWidth,
    channelProfile,
    isSlotCanyon,
    { includeRockNoise: false }
  ).yHeight;
  if (!Number.isFinite(floorReference)) return null;

  const sampleBed = (worldX: number, worldZ: number): number | null => {
    if (worldZ < minZ || worldZ > maxZ) return null;

    // Locate the bracketing centerline pair by world Z.
    let lo = 0;
    for (let i = 0; i < zs.length - 1; i += 1) {
      const a = zs[i];
      const b = zs[i + 1];
      const inside = descending ? worldZ <= a && worldZ >= b : worldZ >= a && worldZ <= b;
      if (inside) {
        lo = i;
        break;
      }
      lo = i;
    }
    const zA = zs[lo];
    const zB = zs[lo + 1];
    const span = zB - zA;
    const alpha = Math.abs(span) < 1e-6 ? 0 : THREE.MathUtils.clamp((worldZ - zA) / span, 0, 1);
    const centerX = THREE.MathUtils.lerp(xs[lo], xs[lo + 1], alpha);
    const t = THREE.MathUtils.lerp(ts[lo], ts[lo + 1], alpha);

    const xLocal = worldX - centerX;
    if (Math.abs(xLocal) > halfWidth) return null;
    const zLocal = t * len - len / 2;

    const { yHeight } = computeCanyonFloorHeight(
      xLocal,
      zLocal,
      len,
      canyonWidth,
      waterWidth,
      channelProfile,
      isSlotCanyon,
      { includeRockNoise: false }
    );
    if (!Number.isFinite(yHeight)) return null;
    return bedFromFloorHeight(yHeight, floorReference);
  };

  return { segmentId, minZ, maxZ, centerX, centerZ, sampleBed };
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
