import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildCanyonGeometry,
  buildCollisionGeometry,
  buildWallShellGeometry,
  buildWaterGeometry,
  ICE_TUBE_PROFILE,
  type GeometryBuildContext,
} from '../../components/TrackSegment/hooks/geometryBuilders';
import type { ChannelProfileSample } from '../../components/TrackSegment/types';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import {
  buildSegmentMeshBuffers,
  contextFromSpec,
  curveFromSpec,
  geometryFromBuffers,
  segmentMeshSpec,
  segmentMeshTransferables,
  segmentPathSpec,
  type GeometryBuffers,
} from '../segmentMeshBuild';

function channel(waterWidth: number, samples = 13): ChannelProfileSample[] {
  return Array.from({ length: samples }, (_, i) => {
    const t = i / (samples - 1);
    return {
      t,
      worldArc: 7 + t,
      leftHalfWidth: waterWidth * 0.5 + Math.sin(i) * 0.6,
      rightHalfWidth: waterWidth * 0.5 - Math.sin(i) * 0.4,
      corridorHalfWidth: Math.max(3.2, waterWidth * 0.35),
      floorDepth: Math.cos(i * 0.7) * 0.5,
      floorWave: Math.sin(i * 1.3) * 0.1,
      riffleStrength: Math.sin(i * 0.4),
      gravelBarSide: i % 2 ? 1 : -1,
      undercutSide: i % 2 ? -1 : 1,
      flowScale: 1 + Math.sin(i) * 0.1,
    };
  });
}

function context(overrides: Partial<GeometryBuildContext> = {}): GeometryBuildContext {
  const curve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, -6, 0),
      new THREE.Vector3(4, -8, -30),
      new THREE.Vector3(-3, -11, -62),
      new THREE.Vector3(1, -13, -95),
    ],
    false,
    'catmullrom',
    0.5,
  );
  return {
    segmentPath: curve,
    segmentId: 7,
    canyonWidth: 35,
    waterWidth: 14,
    biome: 'canyonSummer',
    channelProfile: channel(14),
    isSlotCanyon: false,
    isGlacier: false,
    biomeProfile: getTrackBiomeProfile('canyonSummer'),
    tubeProfile: null,
    ...overrides,
  };
}

function expectSameGeometry(buffers: GeometryBuffers | null, geometry: THREE.BufferGeometry | null) {
  expect(buffers).not.toBeNull();
  expect(geometry).not.toBeNull();
  const names = Object.keys(geometry!.attributes).sort();
  expect(Object.keys(buffers!.attributes).sort()).toEqual(names);
  for (const name of names) {
    expect(buffers!.attributes[name].itemSize).toBe(geometry!.attributes[name].itemSize);
    expect(buffers!.attributes[name].array).toEqual(geometry!.attributes[name].array);
  }
  expect(buffers!.index).toEqual(geometry!.index?.array ?? null);
}

describe('segmentMeshBuild', () => {
  it('round-trips the path through its spec', () => {
    const curve = context().segmentPath;
    const rebuilt = curveFromSpec(segmentPathSpec(curve));
    expect(rebuilt.getLength()).toBe(curve.getLength());
    for (const t of [0, 0.13, 0.5, 0.91, 1]) expect(rebuilt.getPoint(t)).toEqual(curve.getPoint(t));
  });

  it('survives structured clone (what postMessage does to it)', () => {
    const spec = segmentMeshSpec(context({ tubeProfile: ICE_TUBE_PROFILE }));
    expect(structuredClone(spec)).toEqual(spec);
  });

  it.each([
    ['summer meander', {}],
    ['slot canyon', { isSlotCanyon: true, canyonWidth: 24, waterWidth: 8, biome: 'slotCanyon', biomeProfile: getTrackBiomeProfile('slotCanyon') }],
    ['ice tube', { isGlacier: true, canyonWidth: 25, biome: 'glacialMelt', tubeProfile: ICE_TUBE_PROFILE, biomeProfile: getTrackBiomeProfile('glacialMelt') }],
  ] as const)('builds the same meshes from the spec as from the context: %s', (_label, overrides) => {
    const ctx = context(overrides as Partial<GeometryBuildContext>);
    const meshes = buildSegmentMeshBuffers(contextFromSpec(structuredClone(segmentMeshSpec(ctx))));
    expectSameGeometry(meshes.canyon, buildCanyonGeometry(ctx));
    expectSameGeometry(meshes.collision, buildCollisionGeometry(ctx));
    expectSameGeometry(meshes.wallShell, buildWallShellGeometry(ctx));
    expectSameGeometry(meshes.water, buildWaterGeometry(ctx));
  });

  it('lists every array once for transfer and wraps buffers without copying', () => {
    const meshes = buildSegmentMeshBuffers(context());
    const transfer = segmentMeshTransferables(meshes);
    expect(new Set(transfer).size).toBe(transfer.length);
    const canyon = meshes.canyon!;
    for (const { array } of Object.values(canyon.attributes)) expect(transfer).toContain(array.buffer);
    expect(transfer).toContain(canyon.index!.buffer);

    const geometry = geometryFromBuffers(canyon)!;
    expect(geometry.attributes.position.array).toBe(canyon.attributes.position.array);
    expect(geometry.index!.array).toBe(canyon.index);
    expect(geometryFromBuffers(null)).toBeNull();
  });

  it('reports a rejected mesh as null instead of throwing', () => {
    const meshes = buildSegmentMeshBuffers(context({ canyonWidth: Number.NaN }));
    expect(meshes.canyon).toBeNull();
    expect(meshes.collision).toBeNull();
    expect(meshes.water).not.toBeNull();
  });
});
