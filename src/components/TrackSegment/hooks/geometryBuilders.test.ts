import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getTrackBiomeProfile } from '../../../configs/TrackBiomes';
import type { ChannelProfileSample } from '../types';
import {
  buildCanyonGeometry,
  buildCollisionGeometry,
  buildWallShellGeometry,
  buildWaterGeometry,
  canyonSubdivisionCounts,
  CANYON_COLLISION_SUBDIVISION_DIVISOR,
  geometryHasFinitePositions,
  applyTubeProfile,
  resolveTubeProfile,
  ICE_TUBE_PROFILE,
  OVERFLOW_PIPE_PROFILE,
  TUBE_MAX_CANYON_WIDTH,
  type GeometryBuildContext,
} from './geometryBuilders';
import glacialSource from '../../../maps/glacial_source.json';

function makeStraightPath(length = 40): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -1, -length / 3),
    new THREE.Vector3(0, -2, (-length * 2) / 3),
    new THREE.Vector3(0, -3, -length),
  ]);
}

function makeChannelProfile(waterWidth: number, samples = 9): ChannelProfileSample[] {
  const half = waterWidth * 0.5;
  return Array.from({ length: samples }, (_, index) => {
    const t = samples === 1 ? 0 : index / (samples - 1);
    return {
      t,
      worldArc: t,
      leftHalfWidth: half,
      rightHalfWidth: half,
      corridorHalfWidth: Math.max(3.2, half - 1.2),
      floorDepth: 0.2,
      floorWave: 0.05,
      riffleStrength: 0.1,
      gravelBarSide: 1 as const,
      undercutSide: -1 as const,
      flowScale: 1,
    };
  });
}

function makeContext(overrides: Partial<GeometryBuildContext> = {}): GeometryBuildContext {
  const waterWidth = 10;
  const biomeProfile = getTrackBiomeProfile('canyonSummer');
  const segmentPath = makeStraightPath(48);
  return {
    segmentPath,
    segmentId: 0,
    canyonWidth: 35,
    waterWidth,
    biome: 'canyonSummer',
    channelProfile: makeChannelProfile(waterWidth),
    isSlotCanyon: false,
    isGlacier: false,
    biomeProfile,
    ...overrides,
  };
}

describe('TrackSegment geometryBuilders', () => {
  it('builds non-empty canyon/wall/water attributes with no NaN for a finite path', () => {
    const ctx = makeContext();
    const pathLen = ctx.segmentPath.getLength();
    expect(pathLen).toBeGreaterThan(1);

    const canyon = buildCanyonGeometry(ctx);
    const wall = buildWallShellGeometry(ctx);
    const water = buildWaterGeometry(ctx);

    expect(canyon).not.toBeNull();
    expect(wall).not.toBeNull();
    expect(water).not.toBeNull();

    for (const geo of [canyon!, wall!, water!]) {
      const positions = geo.attributes.position;
      expect(positions).toBeDefined();
      expect(positions.count).toBeGreaterThan(0);
      expect(geometryHasFinitePositions(geo)).toBe(true);
    }

    expect(canyon!.attributes.color).toBeDefined();
    expect(canyon!.attributes.color.count).toBe(canyon!.attributes.position.count);
    expect(wall!.attributes.mossMask).toBeDefined();
    expect(wall!.attributes.highWaterMask).toBeDefined();
    expect(wall!.attributes.uv2).toBeDefined();
  });

  it('returns null for an invalid zero-length path', () => {
    const degenerate = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ]);
    const ctx = makeContext({ segmentPath: degenerate });

    expect(buildCanyonGeometry(ctx)).toBeNull();
    expect(buildCollisionGeometry(ctx)).toBeNull();
    expect(buildWallShellGeometry(ctx)).toBeNull();
    expect(buildWaterGeometry(ctx)).toBeNull();
  });

  it('builds a collision mesh with far fewer vertices than the visual canyon mesh', () => {
    const ctx = makeContext();
    const pathLen = ctx.segmentPath.getLength();
    const visualCounts = canyonSubdivisionCounts(pathLen, 'visual');
    const collisionCounts = canyonSubdivisionCounts(pathLen, 'collision');

    expect(collisionCounts.segmentsX).toBeLessThan(visualCounts.segmentsX);
    expect(collisionCounts.segmentsZ).toBeLessThan(visualCounts.segmentsZ);
    expect(collisionCounts.segmentsX * CANYON_COLLISION_SUBDIVISION_DIVISOR).toBeLessThanOrEqual(
      visualCounts.segmentsX
    );

    const visual = buildCanyonGeometry(ctx);
    const collision = buildCollisionGeometry(ctx);
    expect(visual).not.toBeNull();
    expect(collision).not.toBeNull();
    expect(geometryHasFinitePositions(collision!)).toBe(true);

    const visualVerts = visual!.attributes.position.count;
    const collisionVerts = collision!.attributes.position.count;
    // ~1/4 XZ density ⇒ roughly ≤ 1/16 vertices; assert a generous ≪ bound.
    expect(collisionVerts).toBeLessThan(visualVerts / 4);
    expect(collisionVerts).toBeLessThan(visualVerts);
    // Collision mesh skips vertex colors (visual-only attribute).
    expect(collision!.attributes.color).toBeUndefined();
  });

  it('keeps collision ≪ visual vertex counts on slot-canyon and waterfall-length paths', () => {
    const cases: Array<{ label: string; overrides: Partial<GeometryBuildContext>; length: number }> = [
      {
        label: 'slot canyon',
        length: 60,
        overrides: {
          biome: 'slotCanyon',
          isSlotCanyon: true,
          canyonWidth: getTrackBiomeProfile('slotCanyon').canyonWidth,
          biomeProfile: getTrackBiomeProfile('slotCanyon'),
        },
      },
      {
        label: 'waterfall approach',
        length: 90,
        overrides: {
          biome: 'canyonSummer',
          isSlotCanyon: false,
        },
      },
    ];

    for (const { label, length, overrides } of cases) {
      const ctx = makeContext({
        segmentPath: makeStraightPath(length),
        ...overrides,
      });
      const visual = buildCanyonGeometry(ctx);
      const collision = buildCollisionGeometry(ctx);
      expect(visual, label).not.toBeNull();
      expect(collision, label).not.toBeNull();
      const visualVerts = visual!.attributes.position.count;
      const collisionVerts = collision!.attributes.position.count;
      expect(collisionVerts, label).toBeLessThan(visualVerts / 4);
    }
  });
});

describe('ice-tube / overflow-pipe wall profile', () => {
  const TUBE_CANYON_WIDTH = 26;

  function tubeContexts() {
    const waterWidth = 6;
    const base: Partial<GeometryBuildContext> = {
      canyonWidth: TUBE_CANYON_WIDTH,
      waterWidth,
      channelProfile: makeChannelProfile(waterWidth),
      biome: 'glacialMelt',
      biomeProfile: getTrackBiomeProfile('glacialMelt'),
      isGlacier: true,
    };
    return {
      open: makeContext({ ...base, tubeProfile: null }),
      tube: makeContext({ ...base, tubeProfile: ICE_TUBE_PROFILE }),
    };
  }

  function lateralExtent(geometry: THREE.BufferGeometry): number {
    const pos = geometry.attributes.position;
    let max = 0;
    for (let i = 0; i < pos.count; i += 1) max = Math.max(max, Math.abs(pos.getX(i)));
    return max;
  }

  it('only applies to glacial melt and the hydro overflow pipe', () => {
    expect(resolveTubeProfile({ isGlacier: true, biome: 'glacialMelt', canyonWidth: 25 })).toBe(
      ICE_TUBE_PROFILE,
    );
    expect(
      resolveTubeProfile({ isGlacier: false, biome: 'hydroDam', type: 'waterfall', canyonWidth: 20 }),
    ).toBe(OVERFLOW_PIPE_PROFILE);
    // A plunge in any other biome keeps its open sky.
    expect(
      resolveTubeProfile({ isGlacier: false, biome: 'canyonSummer', type: 'waterfall', canyonWidth: 20 }),
    ).toBeNull();
    expect(
      resolveTubeProfile({ isGlacier: false, biome: 'hydroDam', type: 'pond', canyonWidth: 20 }),
    ).toBeNull();
  });

  it('lets the glacial melt-out open back up to the sky', () => {
    const widths = (glacialSource as { segments: Array<{ index: number; width: number }> }).segments;
    const tubed = widths
      .filter((seg) => resolveTubeProfile({ isGlacier: true, biome: 'glacialMelt', canyonWidth: seg.width }))
      .map((seg) => seg.index);

    // The authored tube (entry → apex → crevasse) is roofed…
    expect(tubed).toContain(3);
    expect(tubed).toContain(10);
    // …and the widening back into the alpine fringe is not.
    expect(tubed).not.toContain(14);
    expect(tubed).not.toContain(15);
    expect(TUBE_MAX_CANYON_WIDTH).toBeLessThan(32);
  });

  it('leaves the corridor untouched so the thalweg and water mesh still line up', () => {
    const corridor = makeChannelProfile(6)[0].corridorHalfWidth;
    for (const x of [0, corridor * 0.5, corridor]) {
      const folded = applyTubeProfile(x, 1.4, corridor, TUBE_CANYON_WIDTH * 0.5, ICE_TUBE_PROFILE);
      expect(folded.x).toBe(x);
      expect(folded.y).toBe(1.4);
    }
  });

  it('curls the wall back inward above its widest point — an overhang, not a taper', () => {
    const corridor = 3.2;
    const half = TUBE_CANYON_WIDTH * 0.5;

    // Walk the wall from the springing to the rim and find where it bulges.
    let widest = { x: 0, y: 0 };
    for (let edge = corridor; edge <= half; edge += 0.05) {
      const sample = applyTubeProfile(edge, edge, corridor, half, ICE_TUBE_PROFILE);
      if (sample.x > widest.x) widest = sample;
    }
    const crown = applyTubeProfile(half, 14, corridor, half, ICE_TUBE_PROFILE);

    expect(widest.x).toBeGreaterThan(corridor);
    expect(widest.x).toBeLessThan(half);
    expect(crown.x).toBeLessThan(widest.x);
    expect(crown.x).toBeGreaterThan(0);
    expect(crown.y).toBeCloseTo(ICE_TUBE_PROFILE.ceilingHeight, 6);
    expect(Math.sign(applyTubeProfile(-half, 14, corridor, half, ICE_TUBE_PROFILE).x)).toBe(-1);
  });

  it('narrows the visual canyon it is applied to', () => {
    const { open, tube } = tubeContexts();
    const openGeo = buildCanyonGeometry(open)!;
    const tubeGeo = buildCanyonGeometry(tube)!;

    expect(geometryHasFinitePositions(tubeGeo)).toBe(true);
    expect(lateralExtent(tubeGeo)).toBeLessThan(lateralExtent(openGeo) * 0.6);
  });

  it('gives the collision mesh the same tube the player can see', () => {
    const { open, tube } = tubeContexts();
    const openGeo = buildCollisionGeometry(open)!;
    const tubeGeo = buildCollisionGeometry(tube)!;

    expect(geometryHasFinitePositions(tubeGeo)).toBe(true);
    expect(lateralExtent(tubeGeo)).toBeLessThan(lateralExtent(openGeo) * 0.6);

    // Crown sits below the open-canyon rim: a tunnel, not a taller canyon.
    const peak = (geo: THREE.BufferGeometry) => {
      const pos = geo.attributes.position;
      let max = -Infinity;
      for (let i = 0; i < pos.count; i += 1) max = Math.max(max, pos.getY(i));
      return max;
    };
    expect(peak(tubeGeo)).toBeLessThan(peak(openGeo));
  });
});
