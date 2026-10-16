/**
 * #487 C: one canyon, three consumers. For random points on a segment, the
 * Rapier trimesh floor, the SWE bed and the visual floor must describe the
 * same surface:
 *
 * - trimesh ↔ SWE bed: within 1e-4 after the datum (`b + BED_DATUM` is the
 *   hull floor height above the path). The sampler reads the hull's own grid,
 *   so only float32 world coordinates separate them.
 * - trimesh ↔ visual floor: the visual mesh is the same profile on a 4× finer
 *   grid plus decorative rock noise (≤ 0.4 · (0.5 + normalizedDist) m), so in
 *   the wetted channel they agree within that noise envelope — a datum drift
 *   between builders (e.g. one forgetting the slot lift) breaks it by metres.
 *
 * The test is independent of the sampler's own lookup: it picks a random
 * point inside a random hull triangle (the trimesh's actual geometry) and
 * interpolates that triangle's world y; the sampler has to find the same value
 * from world XZ alone.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChannelProfileSample } from '../../components/TrackSegment/types';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import { BED_DATUM, BATHYMETRY_DRY_BED, createSegmentBathymetrySource } from '../../systems/water/bathymetrySampler';
import { SWE_MEAN_DEPTH } from '../../systems/water/SWEHeightField';
import { ICE_TUBE_PROFILE } from '../../components/TrackSegment/hooks/geometryBuilders';
import { buildSegmentMeshBuffers, type GeometryBuildContext, type GeometryBuffers } from '../segmentMeshBuild';
import { TERRAIN_SLOT_FLOOR_LIFT } from '../terrainTile';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function segment(seed: number, kind: 'summer' | 'slot' | 'tube'): GeometryBuildContext {
  const r = rng(seed);
  const slot = kind === 'slot';
  const tube = kind === 'tube';
  const waterWidth = slot ? 8 : tube ? 10 : 10 + r() * 14;
  const canyonWidth = slot ? 24 : tube ? 25 : waterWidth + 12 + r() * 20;
  const length = 80 + r() * 40;
  const points = [0, 1, 2, 3].map(
    (i) => new THREE.Vector3((r() - 0.5) * 18, -6 - i * (2 + r() * 3), -i * (length / 3)),
  );
  const samples = 30;
  const corridor = Math.max(3.2, Math.min(waterWidth * 0.35, waterWidth * 0.5 - 1.2));
  // Smooth along the path like TrackSegment's generator (smoothNoise / sines of
  // worldArc, wavelengths ≥ ~15 m): the hull's 4 m rows follow it.
  const phase = r() * 10;
  const channelProfile: ChannelProfileSample[] = Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    const riffle = Math.sin((t * 1.35 + phase) * Math.PI);
    const asym = Math.sin(t * 4.7 + phase) * 0.15;
    return {
      t,
      worldArc: seed + t,
      leftHalfWidth: Math.max(corridor + 0.8, waterWidth * 0.5 * (1 + asym)),
      rightHalfWidth: Math.max(corridor + 0.8, waterWidth * 0.5 * (1 - asym)),
      corridorHalfWidth: corridor,
      floorDepth: Math.max(0, -riffle) * 1.1 - Math.max(0, riffle) * 0.35,
      floorWave: Math.sin(t * 6.4 + phase) * 0.18,
      riffleStrength: riffle,
      gravelBarSide: asym > 0 ? 1 : -1,
      undercutSide: asym > 0 ? -1 : 1,
      flowScale: 1 + Math.max(0, riffle) * 0.18,
    };
  });
  const biome = slot ? 'slotCanyon' : tube ? 'glacialMelt' : 'canyonSummer';
  return {
    segmentPath: new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5),
    segmentId: seed,
    canyonWidth,
    waterWidth,
    biome,
    channelProfile,
    isSlotCanyon: slot,
    isGlacier: tube,
    biomeProfile: getTrackBiomeProfile(biome),
    tubeProfile: tube ? ICE_TUBE_PROFILE : null,
  };
}

/** Path point per grid row of a mesh with `segmentsZ` rows, as the builders hang vertices. */
function rowPoints(ctx: GeometryBuildContext, segmentsZ: number): THREE.Vector3[] {
  return Array.from({ length: segmentsZ + 1 }, (_, iz) => {
    const p = ctx.segmentPath.getPoint(iz / segmentsZ);
    return new THREE.Vector3(p.x, p.y, p.z);
  });
}

interface Tri {
  v: [number, number, number];
}

/** Triangles of `mesh` whose vertices all sit at their unfolded grid x (tube walls fold inward). */
function unfoldedTriangles(mesh: GeometryBuffers, rows: THREE.Vector3[], cols: number, width: number): Tri[] {
  const pos = mesh.attributes.position.array;
  const index = mesh.index!;
  const unfolded = (v: number) => {
    const ix = v % cols;
    const row = rows[Math.floor(v / cols)];
    const gridX = ix * (width / (cols - 1)) - width / 2;
    return Math.abs(pos[v * 3] - row.x - gridX) < 1e-3;
  };
  const out: Tri[] = [];
  for (let i = 0; i < index.length; i += 3) {
    const v: [number, number, number] = [index[i], index[i + 1], index[i + 2]];
    if (v.every(unfolded)) out.push({ v });
  }
  return out;
}

/** World y and interpolated path y of `mesh` at world XZ, by containing triangle; null outside. */
function meshFloorAt(
  mesh: GeometryBuffers,
  tris: Tri[],
  rows: THREE.Vector3[],
  cols: number,
  x: number,
  z: number,
): { y: number; pathY: number; pathX: number } | null {
  const pos = mesh.attributes.position.array;
  for (const { v } of tris) {
    const [a, b, c] = v;
    const ax = pos[a * 3], az = pos[a * 3 + 2];
    const bx = pos[b * 3], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cz = pos[c * 3 + 2];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const wc = 1 - wa - wb;
    if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) continue;
    const rowY = (vi: number) => rows[Math.floor(vi / cols)].y;
    const rowX = (vi: number) => rows[Math.floor(vi / cols)].x;
    return {
      y: wa * pos[a * 3 + 1] + wb * pos[b * 3 + 1] + wc * pos[c * 3 + 1],
      pathY: wa * rowY(a) + wb * rowY(b) + wc * rowY(c),
      pathX: wa * rowX(a) + wb * rowX(b) + wc * rowX(c),
    };
  }
  return null;
}

const CASES = [
  ...[1, 2, 3].map((seed) => ({ label: `summer #${seed}`, ctx: segment(seed, 'summer') })),
  ...[4, 5].map((seed) => ({ label: `slot #${seed}`, ctx: segment(seed, 'slot') })),
  { label: 'ice tube #6', ctx: segment(6, 'tube') },
];

describe('one canyon: trimesh, SWE bed and visual floor agree (#487 C)', () => {
  it.each(CASES)('$label: 200 random points', { timeout: 60000 }, ({ ctx }) => {
    const meshes = buildSegmentMeshBuffers(ctx);
    const bed = meshes.bed!;
    const source = createSegmentBathymetrySource(ctx.segmentId, bed)!;
    expect(source).not.toBeNull();

    const hullCols = bed.segmentsX + 1;
    const hullRows = rowPoints(ctx, bed.segmentsZ);
    const hullTris = unfoldedTriangles(meshes.collision!, hullRows, hullCols, ctx.canyonWidth);

    const visualSegmentsZ = Math.max(2, Math.floor(ctx.segmentPath.getLength()));
    const visualCols = 41;
    const visualRows = rowPoints(ctx, visualSegmentsZ);
    const visualTris = unfoldedTriangles(meshes.canyon!, visualRows, visualCols, ctx.canyonWidth);

    const corridor = ctx.channelProfile[0].corridorHalfWidth;
    const hullCell = ctx.canyonWidth / bed.segmentsX;
    const r = rng(ctx.segmentId * 977);
    const pos = meshes.collision!.attributes.position.array;
    let bedChecks = 0;
    let visualChecks = 0;
    let worstBed = 0;
    for (let n = 0; n < 200; n += 1) {
      // A random point inside a random hull triangle: the trimesh's own surface.
      const { v } = hullTris[Math.floor(r() * hullTris.length)];
      let wa = r();
      let wb = r();
      if (wa + wb > 1) {
        wa = 1 - wa;
        wb = 1 - wb;
      }
      const wc = 1 - wa - wb;
      const x = wa * pos[v[0] * 3] + wb * pos[v[1] * 3] + wc * pos[v[2] * 3];
      const z = wa * pos[v[0] * 3 + 2] + wb * pos[v[1] * 3 + 2] + wc * pos[v[2] * 3 + 2];

      const hull = meshFloorAt(meshes.collision!, hullTris, hullRows, hullCols, x, z)!;
      expect(hull).not.toBeNull();
      const hullHeight = hull.y - hull.pathY;

      // Trimesh ↔ SWE bed, after the datum.
      const floor = source.sampleFloorHeight(x, z);
      expect(floor, `floor @(${x.toFixed(2)}, ${z.toFixed(2)})`).not.toBeNull();
      worstBed = Math.max(worstBed, Math.abs(floor! - hullHeight));
      const b = source.sampleBed(x, z)!;
      if (b > -SWE_MEAN_DEPTH && b < BATHYMETRY_DRY_BED) {
        expect(Math.abs(b + BED_DATUM - hullHeight)).toBeLessThan(1e-4);
      }
      bedChecks += 1;

      // Trimesh ↔ visual floor inside the corridor, a hull cell clear of the
      // bank: the profile is smooth there. At the bank it steps (0.1× → 1×),
      // and the 4× coarser hull spreads that step across a cell by design.
      const visual = meshFloorAt(meshes.canyon!, visualTris, visualRows, visualCols, x, z);
      const xLocal = Math.abs(x - hull.pathX);
      if (visual && xLocal < corridor - hullCell) {
        const normalizedDist = xLocal / (ctx.canyonWidth * 0.45);
        const noise = 0.4 * (0.5 + normalizedDist);
        expect(Math.abs(visual.y - visual.pathY - hullHeight), `visual @(${x.toFixed(2)}, ${z.toFixed(2)})`).toBeLessThan(
          noise + 0.15,
        );
        visualChecks += 1;
      }
    }
    expect(worstBed).toBeLessThan(1e-4);
    expect(bedChecks).toBe(200);
    expect(visualChecks).toBeGreaterThan(5);
  });

  it('the slot canyon thalweg sits on the shared datum, not ~4 m above the water sheet', () => {
    const slot = buildSegmentMeshBuffers(segment(4, 'slot')).bed!;
    const summer = buildSegmentMeshBuffers(segment(1, 'summer')).bed!;
    const centre = (g: typeof slot) => {
      const cols = g.segmentsX + 1;
      const mid = Math.floor(g.segmentsX / 2);
      let min = Infinity;
      for (let iz = 0; iz <= g.segmentsZ; iz += 1) min = Math.min(min, g.h[iz * cols + mid]);
      return min;
    };
    // Both thalwegs reach below the water sheet (WATER_LEVEL above the path).
    expect(centre(slot)).toBeLessThan(BED_DATUM + SWE_MEAN_DEPTH);
    expect(centre(summer)).toBeLessThan(BED_DATUM + SWE_MEAN_DEPTH);
    expect(Math.abs(centre(slot) - centre(summer))).toBeLessThan(TERRAIN_SLOT_FLOOR_LIFT / 2);
  });
});
