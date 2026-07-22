import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getTrackBiomeProfile } from '../../../configs/TrackBiomes';
import type { ChannelProfileSample } from '../types';
import {
  buildCanyonGeometry,
  buildWallShellGeometry,
  buildWaterGeometry,
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
    expect(buildWallShellGeometry(ctx)).toBeNull();
    expect(buildWaterGeometry(ctx)).toBeNull();
  });
});
