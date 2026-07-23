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
  type GeometryBuildContext,
} from './geometryBuilders';

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
