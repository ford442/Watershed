/**
 * #487 E: the eroded floor — one offset, three consumers.
 *
 * The plane lives on the hull grid; the trimesh and the bed take it at their
 * own vertices and the visual floor interpolates it over the hull's triangles,
 * so at every hull vertex the three move by the same amount (1e-4: float32
 * world positions only).
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChannelProfileSample } from '../../components/TrackSegment/types';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import { clearSegmentBathymetry, createSegmentBathymetrySource } from '../../systems/water/bathymetrySampler';
import {
  accumulateErosion,
  EROSION_CRITICAL_FLUX,
  EROSION_MAX_DEPTH,
  EROSION_RATE,
  erodeSegmentMeshes,
  erosionOffset,
  erosionOffsetAtGrid,
  erosionPlaneSize,
  erosionRate,
  type ErosionFieldView,
} from '../erosion';
import { decodeErosionPlane, encodeErosionPlane } from '../erosionCodec';
import {
  buildSegmentMeshBuffers,
  CANYON_VISUAL_SEGMENTS_X,
  type GeometryBuffers,
  type GeometryBuildContext,
  type SegmentMeshBuffers,
} from '../segmentMeshBuild';

/** A straight 100.68 m path: 100 visual rows and 25 hull rows, so every 4th visual row is a hull row. */
function straightSegment(): GeometryBuildContext {
  const waterWidth = 12;
  const half = waterWidth / 2;
  const channelProfile: ChannelProfileSample[] = Array.from({ length: 21 }, (_, i) => ({
    t: i / 20,
    worldArc: i / 20,
    leftHalfWidth: half,
    rightHalfWidth: half,
    corridorHalfWidth: half - 1.2,
    floorDepth: 0.6,
    floorWave: 0,
    riffleStrength: 0,
    gravelBarSide: 1,
    undercutSide: -1,
    flowScale: 1,
  }));
  return {
    segmentPath: new THREE.CatmullRomCurve3([0, 1, 2, 3].map((i) => new THREE.Vector3(4, -6 - 2 * i, -33.5 * i))),
    segmentId: 7,
    canyonWidth: 40,
    waterWidth,
    biome: 'canyonSummer',
    channelProfile,
    isSlotCanyon: false,
    isGlacier: false,
    biomeProfile: getTrackBiomeProfile('canyonSummer'),
  };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const y = (buffers: GeometryBuffers, vertex: number) => buffers.attributes.position.array[vertex * 3 + 1];

function built(): SegmentMeshBuffers {
  const meshes = buildSegmentMeshBuffers(straightSegment());
  expect(meshes.bed).not.toBeNull();
  expect(meshes.bed!.segmentsX).toBe(10);
  expect(meshes.bed!.segmentsZ).toBe(25);
  return meshes;
}

afterEach(() => clearSegmentBathymetry());

describe('erosion offset and rate', () => {
  it('scour lowers the floor, a bar raises it, both clamped to ±EROSION_MAX_DEPTH', () => {
    expect(erosionOffset(0.1)).toBeCloseTo(-0.1, 6);
    expect(erosionOffset(-0.1)).toBeCloseTo(0.1, 6);
    expect(erosionOffset(5)).toBe(-EROSION_MAX_DEPTH);
    expect(erosionOffset(-5)).toBe(EROSION_MAX_DEPTH);
  });

  it('still water leaves the bed alone; fast water scours; slowed water deposits', () => {
    expect(erosionRate(0)).toBe(-0);
    expect(erosionRate(EROSION_CRITICAL_FLUX)).toBe(0);
    expect(erosionRate(EROSION_CRITICAL_FLUX + 1)).toBeCloseTo(EROSION_RATE, 9);
    expect(erosionRate(EROSION_CRITICAL_FLUX / 2)).toBeLessThan(0);
    // Continuous at q_c from both sides.
    expect(Math.abs(erosionRate(EROSION_CRITICAL_FLUX * 0.999))).toBeLessThan(1e-5);
  });
});

describe('accumulateErosion', () => {
  /** A window over the segment's first half: wet and running −Z west of x = 4, dry east of it. */
  function field(): ErosionFieldView {
    const width = 41;
    const height = 101;
    const n = width * height;
    const cell = 0.5;
    const originX = -6;
    const originZ = -50;
    const b = new Float32Array(n);
    const w = new Float32Array(n);
    for (let gz = 0; gz < height; gz += 1) {
      for (let gx = 0; gx < width; gx += 1) {
        const x = originX + gx * cell;
        b[gz * width + gx] = x < 4 ? 0 : 5;
        w[gz * width + gx] = -1;
      }
    }
    return { h: new Float32Array(n), u: new Float32Array(n), w, b, width, height, cellSize: cell, originX, originZ, stillDepth: 1 };
  }

  it('integrates shear on wet vertices inside the window, and nowhere else', () => {
    const bed = built().bed!;
    const plane = new Float32Array(erosionPlaneSize(bed));
    const moved = accumulateErosion(plane, bed, field(), 2);
    const expected = erosionRate(1) * 2;
    expect(moved).toBeCloseTo(expected, 6);
    const cols = bed.segmentsX + 1;
    let wet = 0;
    for (let iz = 0; iz <= bed.segmentsZ; iz += 1) {
      const z = bed.rows[iz * 3 + 2];
      for (let ix = 0; ix < cols; ix += 1) {
        const x = bed.rows[iz * 3] + ix * (bed.width / bed.segmentsX) - bed.width / 2;
        const e = plane[iz * cols + ix];
        const inside = z >= -50 && z <= 0 && x >= -6 && x <= 14;
        // Strictly west of the dry step (bilinear blends the cell that straddles it).
        if (inside && x < 3.5) {
          expect(e).toBeCloseTo(expected, 6);
          wet += 1;
        } else if (!inside || x > 4.5) {
          expect(e).toBe(0);
        }
      }
    }
    expect(wet).toBeGreaterThan(10);
  });

  it('clamps at the maximum depth however long the flood', () => {
    const bed = built().bed!;
    const plane = new Float32Array(erosionPlaneSize(bed));
    accumulateErosion(plane, bed, field(), 1e5);
    expect(Math.max(...plane)).toBeCloseTo(EROSION_MAX_DEPTH, 6);
  });
});

describe('erodeSegmentMeshes', () => {
  it('moves the visual floor, the trimesh and the bed by the same amount at every hull vertex (1e-4)', () => {
    const base = built();
    const bed = base.bed!;
    const r = rng(487);
    const plane = Float32Array.from({ length: erosionPlaneSize(bed) }, () => (r() - 0.5) * 1.2);
    const eroded = erodeSegmentMeshes(base, plane, CANYON_VISUAL_SEGMENTS_X);
    const before = createSegmentBathymetrySource(1, bed)!;
    const after = createSegmentBathymetrySource(1, eroded.bed)!;
    const cols = bed.segmentsX + 1;
    const vCols = CANYON_VISUAL_SEGMENTS_X + 1;
    const ratio = CANYON_VISUAL_SEGMENTS_X / bed.segmentsX;
    for (let iz = 0; iz <= bed.segmentsZ; iz += 1) {
      for (let ix = 0; ix < cols; ix += 1) {
        const i = iz * cols + ix;
        const offset = erosionOffset(plane[i]);
        const trimesh = y(eroded.collision!, i) - y(base.collision!, i);
        const v = iz * ratio * vCols + ix * ratio;
        const visual = y(eroded.canyon!, v) - y(base.canyon!, v);
        const worldX = bed.rows[iz * 3] + ix * (bed.width / bed.segmentsX) - bed.width / 2;
        const worldZ = bed.rows[iz * 3 + 2];
        const sampled = after.sampleFloorHeight(worldX, worldZ)! - before.sampleFloorHeight(worldX, worldZ)!;
        expect(Math.abs(trimesh - offset)).toBeLessThan(1e-4);
        expect(Math.abs(visual - offset)).toBeLessThan(1e-4);
        expect(Math.abs(eroded.bed!.h[i] - bed.h[i] - offset)).toBeLessThan(1e-4);
        expect(Math.abs(sampled - offset)).toBeLessThan(1e-4);
      }
    }
  });

  it('between hull vertices the visual floor follows the hull’s own triangles', () => {
    const base = built();
    const bed = base.bed!;
    const plane = new Float32Array(erosionPlaneSize(bed));
    plane[3 * (bed.segmentsX + 1) + 4] = 0.3;
    const eroded = erodeSegmentMeshes(base, plane, CANYON_VISUAL_SEGMENTS_X);
    const vCols = CANYON_VISUAL_SEGMENTS_X + 1;
    for (const [vx, vz] of [[17, 13], [18, 10], [15, 14], [16, 12]]) {
      const v = vz * vCols + vx;
      const expected = erosionOffsetAtGrid(plane, bed.segmentsX, bed.segmentsZ, vx / 4, vz / 4);
      expect(y(eroded.canyon!, v) - y(base.canyon!, v)).toBeCloseTo(expected, 4);
    }
    // The scour shows in the floor, and only around its vertex.
    expect(y(eroded.canyon!, 12 * vCols + 16) - y(base.canyon!, 12 * vCols + 16)).toBeCloseTo(-0.3, 4);
    expect(y(eroded.canyon!, 2 * vCols + 30)).toBe(y(base.canyon!, 2 * vCols + 30));
  });

  it('an untouched plane, or one for another grid, leaves the meshes as built', () => {
    const base = built();
    expect(erodeSegmentMeshes(base, new Float32Array(erosionPlaneSize(base.bed!)), CANYON_VISUAL_SEGMENTS_X)).toBe(base);
    expect(erodeSegmentMeshes(base, new Float32Array(3).fill(0.1), CANYON_VISUAL_SEGMENTS_X)).toBe(base);
  });

  it('re-erodes from the floor as built: the walls and the water sheet never move', () => {
    const base = built();
    const plane = new Float32Array(erosionPlaneSize(base.bed!)).fill(0.2);
    const once = erodeSegmentMeshes(base, plane, CANYON_VISUAL_SEGMENTS_X);
    expect(y(base.collision!, 5)).not.toBe(y(once.collision!, 5));
    expect(once.wallShell).toBe(base.wallShell);
    expect(once.water).toBe(base.water);
    const twice = erodeSegmentMeshes(base, plane, CANYON_VISUAL_SEGMENTS_X);
    expect(y(twice.collision!, 5)).toBe(y(once.collision!, 5));
  });
});

describe('erosionCodec', () => {
  it('round-trips a plane to the quantization step and collapses untouched runs', () => {
    const r = rng(9);
    const plane = new Float32Array(286);
    for (let i = 40; i < 90; i += 1) plane[i] = (r() - 0.5) * 0.8;
    plane[200] = 0.4;
    plane[201] = -0.4;
    const text = encodeErosionPlane(plane);
    expect(text.length).toBeLessThan(120);
    const back = decodeErosionPlane(text, plane.length)!;
    for (let i = 0; i < plane.length; i += 1) expect(Math.abs(back[i] - plane[i])).toBeLessThanOrEqual(0.4 / 127 / 2 + 1e-7);
    expect(back[0]).toBe(0);
    expect(back[285]).toBe(0);
  });

  it('refuses a plane of another size and text that is not a plane', () => {
    const text = encodeErosionPlane(new Float32Array(50).fill(0.1));
    expect(decodeErosionPlane(text, 49)).toBeNull();
    expect(decodeErosionPlane(text, 51)).toBeNull();
    expect(decodeErosionPlane('not base64!', 50)).toBeNull();
    expect(decodeErosionPlane(btoa(String.fromCharCode(0x80)), 50)).toBeNull();
    expect(decodeErosionPlane(encodeErosionPlane(new Float32Array(600)), 600)).toEqual(new Float32Array(600));
  });
});
