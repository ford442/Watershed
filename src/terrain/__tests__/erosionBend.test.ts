// @vitest-environment node
/**
 * #487 E acceptance: after a scripted storm, the outside of meander's second
 * bend has eroded differently from a clear day — and from its inside.
 *
 * Bend 2 is the centreline's second turning point (x(z) changes direction),
 * found on the generated path rather than hard-coded: at the default seed the
 * river swings west through segment −1, then east to its turn in segment 9.
 *
 * Real pieces end to end: that segment's path from the treadmill
 * (ChunkManager, default seed), its hull grid from the segment builder, the bed
 * rasterized from that hull, the committed C++ stepper driven at its upstream
 * edge by the routed stage for a clear and a storm launch, and the erosion
 * integrator over every step.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import { getMapDefinition } from '../../maps/registry';
import { ChunkManager } from '../../systems/map/ChunkManager';
import { DEFAULT_MAP_CONFIG, ProceduralMapManager } from '../../systems/map/MapSystem';
import {
  clearSegmentBathymetry,
  createSegmentBathymetrySource,
  registerSegmentBathymetry,
  sampleBathymetryInto,
} from '../../systems/water/bathymetrySampler';
import { routedEdgeEtaAt } from '../../systems/water/hydroContrast';
import { SWE_MEAN_DEPTH } from '../../systems/water/SWEHeightField';
import { createWasmSweSim } from '../../systems/water/sweSim';
import type { WatershedNativeModule } from '../../systems/water/wasmAbi';
import { loadNativeFromDisk } from '../../testing/nativeFromDisk';
import { accumulateErosion, erosionPlaneSize } from '../erosion';
import { buildSegmentMeshBuffers, type SegmentBedGrid, type SegmentPath } from '../segmentMeshBuild';

const HOUR = 14;
const CELL = 0.5;
const DT = 1 / 60;
const SECONDS = 25;

/** Meander's first `count` segments, as the treadmill builds them at the default seed. */
function meanderPaths(count: number): Array<{ id: number; path: SegmentPath }> {
  const def = getMapDefinition('meander');
  const manager = new ProceduralMapManager(def.levelData, def.fallbackProgression, {}, def.continuation ?? null);
  const chunks = new ChunkManager({ mapManager: manager, startIndex: def.startIndex, proceduralBaseSeed: DEFAULT_MAP_CONFIG.seed });
  chunks.initializePool();
  const seen = new Map<number, SegmentPath>();
  for (let step = 0; step < 60 && seen.size < count; step += 1) {
    for (const s of chunks.getActiveSegments()) if (!seen.has(s.id)) seen.set(s.id, s.segmentPath);
    chunks.update(chunks.getActiveSegments().at(-1)!.segmentPath.getPoint(0.5).z);
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).slice(0, count).map(([id, p]) => ({ id, path: p }));
}

/** How far a segment's middle sits off its chord, across (m, signed in x). */
function bulgeOf(p: SegmentPath): number {
  return p.getPoint(0.5).x - (p.getPoint(0).x + p.getPoint(1).x) / 2;
}

/** A turning point counts once the river has swung back this far from it (m): wiggles are not bends. */
const BEND_SWING = 10;

/**
 * The segment holding the centreline's `n`-th turning point in x: the running
 * extreme, once x has come back BEND_SWING from it.
 */
function nthBend(segments: Array<{ id: number; path: SegmentPath }>, n: number): { id: number; path: SegmentPath } {
  const samples = segments.flatMap((seg, k) =>
    Array.from({ length: 11 }, (_, i) => ({ k, x: seg.path.getPoint(i / 10).x })),
  );
  let direction = 0;
  let extreme = samples[0];
  let found = 0;
  for (const sample of samples) {
    if (direction === 0) {
      if (Math.abs(sample.x - samples[0].x) >= BEND_SWING) {
        direction = Math.sign(sample.x - samples[0].x);
        extreme = sample;
      }
      continue;
    }
    if ((sample.x - extreme.x) * direction > 0) {
      extreme = sample;
      continue;
    }
    if (Math.abs(sample.x - extreme.x) < BEND_SWING) continue;
    found += 1;
    if (found === n) return segments[extreme.k];
    direction = -direction;
    extreme = sample;
  }
  throw new Error(`meander has fewer than ${n} bends`);
}

interface BendRun {
  plane: Float32Array;
  bed: SegmentBedGrid;
}

let wasm: WatershedNativeModule;
let path: SegmentPath;
let bendSegment: number;

beforeAll(async () => {
  wasm = await loadNativeFromDisk();
  const bend = nthBend(meanderPaths(18), 2);
  path = bend.path;
  bendSegment = bend.id;
});

/** Step the window over the whole segment for SECONDS at `edgeEta`, eroding as it goes. */
function runOverBend(edgeEta: number): BendRun {
  const profile = getTrackBiomeProfile('canyonSummer');
  const meshes = buildSegmentMeshBuffers({
    segmentPath: path,
    segmentId: bendSegment,
    canyonWidth: profile.canyonWidth,
    waterWidth: profile.waterWidth,
    biome: 'canyonSummer',
    channelProfile: [],
    isSlotCanyon: false,
    isGlacier: false,
    biomeProfile: profile,
  });
  const bed = meshes.bed!;
  clearSegmentBathymetry();
  registerSegmentBathymetry(bendSegment, createSegmentBathymetrySource(bendSegment, bed));

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let iz = 0; iz <= bed.segmentsZ; iz += 1) {
    minX = Math.min(minX, bed.rows[iz * 3] - bed.width / 2);
    maxX = Math.max(maxX, bed.rows[iz * 3] + bed.width / 2);
    minZ = Math.min(minZ, bed.rows[iz * 3 + 2]);
    maxZ = Math.max(maxZ, bed.rows[iz * 3 + 2]);
  }
  const originX = Math.floor(minX / CELL) * CELL;
  const originZ = Math.floor(minZ / CELL) * CELL;
  const width = Math.ceil((maxX - originX) / CELL) + 1;
  const height = Math.ceil((maxZ - originZ) / CELL) + 1;
  const sim = createWasmSweSim(wasm, width, height, CELL);
  sampleBathymetryInto(sim.b, originX, originZ, CELL, width, height);

  const plane = new Float32Array(erosionPlaneSize(bed));
  const view = { h: sim.h, u: sim.u, w: sim.w, b: sim.b, width, height, cellSize: CELL, originX, originZ, stillDepth: SWE_MEAN_DEPTH };
  for (let s = 0; s < SECONDS / DT; s += 1) {
    sim.step({ dt: DT, g: 9.80665, H: SWE_MEAN_DEPTH, originX, originZ, events: [], edgeEta });
    accumulateErosion(plane, bed, view, DT);
  }
  sim.dispose();
  clearSegmentBathymetry();
  return { plane, bed };
}

/**
 * Mean E along the channel's two flanks — the hull columns just past the
 * water's edge (waterWidth / 2 to one column beyond) — over the bend's middle
 * rows. The outside is the side the path bulges toward.
 */
function bendSides({ plane, bed }: BendRun): { outside: number; inside: number } {
  const bulge = bulgeOf(path);
  expect(Math.abs(bulge), `segment ${bendSegment} bends`).toBeGreaterThan(2);
  const outsideSign = Math.sign(bulge);
  const cols = bed.segmentsX + 1;
  const sums = { outside: 0, inside: 0, nOut: 0, nIn: 0 };
  for (let iz = Math.floor(bed.segmentsZ * 0.25); iz <= Math.ceil(bed.segmentsZ * 0.75); iz += 1) {
    for (let ix = 0; ix < cols; ix += 1) {
      const across = ix * (bed.width / bed.segmentsX) - bed.width / 2;
      const flank = getTrackBiomeProfile('canyonSummer').waterWidth / 2;
      if (Math.abs(across) < flank || Math.abs(across) > flank + bed.width / bed.segmentsX) continue;
      const e = plane[iz * cols + ix];
      if (Math.sign(across) === outsideSign) {
        sums.outside += e;
        sums.nOut += 1;
      } else {
        sums.inside += e;
        sums.nIn += 1;
      }
    }
  }
  return { outside: sums.outside / sums.nOut, inside: sums.inside / sums.nIn };
}

describe('erosion over meander’s second bend', () => {
  it('a storm works the outside of the bend, unlike a clear day and unlike the inside', () => {
    const clearEta = routedEdgeEtaAt(wasm, 'meander', bendSegment, HOUR);
    const stormEta = routedEdgeEtaAt(wasm, 'meander', bendSegment, HOUR, { type: 'storm', intensity: 0.9 });
    expect(stormEta).toBeGreaterThan(clearEta);
    const clear = bendSides(runOverBend(clearEta));
    const storm = bendSides(runOverBend(stormEta));
    // The storm digs the outside flank well past what the same hour does clear…
    expect(storm.outside).toBeGreaterThan(clear.outside * 1.5);
    expect(storm.outside - clear.outside).toBeGreaterThan(0.01);
    // …and the outside of the bend past its inside.
    expect(storm.outside).toBeGreaterThan(storm.inside * 1.25);
  });
});
