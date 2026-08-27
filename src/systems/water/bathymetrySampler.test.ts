import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import type { ChannelProfileSample } from '../../components/TrackSegment/types';
import type { GeometryBuildContext } from '../../components/TrackSegment/hooks/geometryBuilders';
import { SWE_MEAN_DEPTH } from './SWEHeightField';
import {
  BATHYMETRY_DRY_BED,
  bedFromFloorHeight,
  clearSegmentBathymetry,
  createSegmentBathymetrySource,
  getBathymetryRevision,
  registerSegmentBathymetry,
  sampleBathymetryInto,
  unregisterSegmentBathymetry,
} from './bathymetrySampler';

const LENGTH = 48;

function makeStraightPath(length = LENGTH, xOffset = 0): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(xOffset, 0, 0),
    new THREE.Vector3(xOffset, -1, -length / 3),
    new THREE.Vector3(xOffset, -2, (-length * 2) / 3),
    new THREE.Vector3(xOffset, -3, -length),
  ]);
}

function makeChannelProfile(waterWidth: number, floorDepth = 0.6): ChannelProfileSample[] {
  const half = waterWidth * 0.5;
  return Array.from({ length: 9 }, (_, index) => {
    const t = index / 8;
    return {
      t,
      worldArc: t,
      leftHalfWidth: half,
      rightHalfWidth: half,
      corridorHalfWidth: Math.max(3.2, half - 1.2),
      floorDepth,
      floorWave: 0,
      riffleStrength: 0,
      gravelBarSide: 1 as const,
      undercutSide: -1 as const,
      flowScale: 1,
    };
  });
}

function makeContext(overrides: Partial<GeometryBuildContext> = {}): GeometryBuildContext {
  const waterWidth = 10;
  return {
    segmentPath: makeStraightPath(),
    segmentId: 0,
    canyonWidth: 35,
    waterWidth,
    biome: 'canyonSummer',
    channelProfile: makeChannelProfile(waterWidth),
    isSlotCanyon: false,
    isGlacier: false,
    biomeProfile: getTrackBiomeProfile('canyonSummer'),
    ...overrides,
  };
}

/** Depth the solver sees at rest for a bed value. */
const restDepth = (bed: number) => SWE_MEAN_DEPTH - bed;

afterEach(() => {
  clearSegmentBathymetry();
});

describe('bedFromFloorHeight', () => {
  it('puts the thalweg reference at the full still depth', () => {
    expect(bedFromFloorHeight(3.9, 3.9)).toBeCloseTo(0, 6);
    expect(restDepth(bedFromFloorHeight(3.9, 3.9))).toBeCloseTo(SWE_MEAN_DEPTH, 6);
    // A floor standing H above the thalweg is exactly the drying threshold.
    expect(restDepth(bedFromFloorHeight(3.9 + SWE_MEAN_DEPTH, 3.9))).toBeCloseTo(0, 6);
  });

  it('clamps banks to the dry ceiling and never emits NaN', () => {
    expect(bedFromFloorHeight(500, 0)).toBe(BATHYMETRY_DRY_BED);
    expect(bedFromFloorHeight(Number.NaN, 0)).toBe(BATHYMETRY_DRY_BED);
  });
});

describe('createSegmentBathymetrySource', () => {
  it('rejects a degenerate path', () => {
    const zero = new THREE.Vector3(0, 0, 0);
    const path = new THREE.CatmullRomCurve3([zero.clone(), zero.clone(), zero.clone(), zero.clone()]);
    expect(createSegmentBathymetrySource(makeContext({ segmentPath: path }))).toBeNull();
  });

  it('returns null outside its own Z span and outside the canyon width', () => {
    const source = createSegmentBathymetrySource(makeContext())!;
    expect(source.sampleBed(0, 20)).toBeNull();
    expect(source.sampleBed(0, -200)).toBeNull();
    expect(source.sampleBed(400, -LENGTH / 2)).toBeNull();
  });

  it('is wet mid-channel and dry on the banks', () => {
    const source = createSegmentBathymetrySource(makeContext())!;
    const z = -LENGTH / 2;
    const mid = source.sampleBed(0, z)!;
    const bank = source.sampleBed(16, z)!;
    expect(restDepth(mid)).toBeGreaterThan(0.1);
    expect(restDepth(bank)).toBeLessThanOrEqual(0);
    expect(bank).toBeGreaterThan(mid);
  });

  it('gives a slot canyon a narrower wet channel than a wide summer canyon', () => {
    const z = -LENGTH / 2;
    const summer = createSegmentBathymetrySource(makeContext())!;
    const slot = createSegmentBathymetrySource(
      makeContext({ isSlotCanyon: true, waterWidth: 6, channelProfile: makeChannelProfile(6) })
    )!;
    const wetCells = (source: NonNullable<ReturnType<typeof createSegmentBathymetrySource>>) => {
      let wet = 0;
      for (let x = -17; x <= 17; x += 0.5) {
        const bed = source.sampleBed(x, z);
        if (bed !== null && restDepth(bed) > 0) wet += 1;
      }
      return wet;
    };
    expect(wetCells(slot)).toBeLessThan(wetCells(summer));
    expect(wetCells(slot)).toBeGreaterThan(0);
  });

  it('follows the centerline when the path is offset in X', () => {
    const offset = createSegmentBathymetrySource(
      makeContext({ segmentPath: makeStraightPath(LENGTH, 12) })
    )!;
    const z = -LENGTH / 2;
    expect(restDepth(offset.sampleBed(12, z)!)).toBeGreaterThan(0.1);
    expect(restDepth(offset.sampleBed(0, z)!)).toBeLessThanOrEqual(0);
  });
});

describe('sampleBathymetryInto', () => {
  const WIDTH = 24;
  const HEIGHT = 16;
  const CELL = 0.5;

  const fill = (originX: number, originZ: number) => {
    const target = new Float32Array(WIDTH * HEIGHT);
    const covered = sampleBathymetryInto(target, originX, originZ, CELL, WIDTH, HEIGHT);
    return { target, covered };
  };

  it('writes the dry bed everywhere when nothing is registered', () => {
    const { target, covered } = fill(-6, -30);
    expect(covered).toBe(0);
    expect([...target].every((v) => v === BATHYMETRY_DRY_BED)).toBe(true);
  });

  it('rasterizes a registered U-channel with a wet thalweg between dry banks', () => {
    registerSegmentBathymetry(0, createSegmentBathymetrySource(makeContext()));
    const originZ = -LENGTH / 2 - (HEIGHT * CELL) / 2;
    const { target, covered } = fill(-(WIDTH * CELL) / 2, originZ);
    expect(covered).toBe(WIDTH * HEIGHT);

    const row = HEIGHT / 2;
    const at = (gx: number) => target[row * WIDTH + gx];
    expect(restDepth(at(WIDTH / 2))).toBeGreaterThan(0.1);
    expect(restDepth(at(0))).toBeLessThanOrEqual(0);
    expect(restDepth(at(WIDTH - 1))).toBeLessThanOrEqual(0);
  });

  it('is flatter and wetter for a wide pond than for a slot canyon', () => {
    const originX = -(WIDTH * CELL) / 2;
    const originZ = -LENGTH / 2 - (HEIGHT * CELL) / 2;

    registerSegmentBathymetry(
      0,
      createSegmentBathymetrySource(
        makeContext({ isSlotCanyon: true, waterWidth: 6, channelProfile: makeChannelProfile(6) })
      )
    );
    const slot = fill(originX, originZ).target;

    clearSegmentBathymetry();
    registerSegmentBathymetry(
      0,
      createSegmentBathymetrySource(
        makeContext({ waterWidth: 30, canyonWidth: 60, channelProfile: makeChannelProfile(30, 0.2) })
      )
    );
    const pond = fill(originX, originZ).target;

    const wet = (field: Float32Array) => [...field].filter((b) => restDepth(b) > 0).length;
    const spread = (field: Float32Array) => Math.max(...field) - Math.min(...field);

    expect(wet(pond)).toBeGreaterThan(wet(slot));
    expect(spread(pond)).toBeLessThan(spread(slot));
  });

  it('does not leak a recycled segment into the next window', () => {
    const originX = -(WIDTH * CELL) / 2;
    const originZ = -LENGTH / 2 - (HEIGHT * CELL) / 2;

    registerSegmentBathymetry(3, createSegmentBathymetrySource(makeContext({ segmentId: 3 })));
    const before = fill(originX, originZ).target;
    expect([...before].some((b) => restDepth(b) > 0)).toBe(true);

    // Slot 3 recycles onto a canyon far downstream — the old bed must vanish.
    registerSegmentBathymetry(
      3,
      createSegmentBathymetrySource(
        makeContext({ segmentId: 3, segmentPath: makeStraightPath(LENGTH).clone() })
      )
    );
    unregisterSegmentBathymetry(3);
    const after = fill(originX, originZ).target;
    expect([...after].every((b) => b === BATHYMETRY_DRY_BED)).toBe(true);
  });

  it('bumps the revision only when the registered set changes', () => {
    const start = getBathymetryRevision();
    registerSegmentBathymetry(1, createSegmentBathymetrySource(makeContext({ segmentId: 1 })));
    expect(getBathymetryRevision()).toBeGreaterThan(start);
    const afterRegister = getBathymetryRevision();
    unregisterSegmentBathymetry(99);
    expect(getBathymetryRevision()).toBe(afterRegister);
    unregisterSegmentBathymetry(1);
    expect(getBathymetryRevision()).toBeGreaterThan(afterRegister);
  });
});
