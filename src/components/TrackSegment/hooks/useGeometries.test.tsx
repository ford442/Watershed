import * as THREE from 'three';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTrackBiomeProfile } from '../../../configs/TrackBiomes';
import type { SimTileResult } from '../../../sim/simWorkerProtocol';
import { buildSegmentMeshBuffers, contextFromSpec, type SegmentMeshSpec } from '../../../terrain/segmentMeshBuild';
import type { UseGeometriesParams } from '../types';

const proxy = { requestTile: vi.fn<(spec: SegmentMeshSpec) => Promise<SimTileResult | null>>() };
let live: typeof proxy | null = null;
vi.mock('../../../sim/createSimWorkerProxy', () => ({ peekSimWorkerProxy: () => live }));
vi.mock('../../../systems/water/bathymetrySampler', () => ({
  createSegmentBathymetrySource: () => null,
  registerSegmentBathymetry: () => {},
  unregisterSegmentBathymetry: () => {},
}));

const { useGeometries } = await import('./useGeometries');

function params(overrides: Partial<UseGeometriesParams> = {}): UseGeometriesParams {
  const segmentPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(2, -1, -30),
    new THREE.Vector3(-2, -2, -60),
    new THREE.Vector3(0, -3, -90),
  ]);
  return {
    active: true,
    segmentPath,
    pathLength: segmentPath.getLength(),
    segmentId: 9,
    type: 'normal',
    channelProfile: [],
    biomeProfile: getTrackBiomeProfile('canyonSummer'),
    isSlotCanyon: false,
    canyonWidth: 30,
    waterWidth: 12,
    biome: 'canyonSummer',
    ...overrides,
  };
}

/** Props built once: a new path object per render would be a new segment per render. */
function renderStable(overrides: Partial<UseGeometriesParams>) {
  const props = params(overrides);
  return renderHook(() => useGeometries(props));
}

afterEach(() => {
  live = null;
  proxy.requestTile.mockReset();
});

describe('useGeometries worker build (#487 B)', () => {
  it('builds on the main thread without a live sim worker', () => {
    const { result } = renderStable({ buildAhead: true });
    expect(result.current.source).toBe('main');
    expect(result.current.canyonGeometry).not.toBeNull();
  });

  it('builds the boot / restart pool here even with a worker', () => {
    live = proxy;
    const { result } = renderStable({ buildAhead: false });
    expect(proxy.requestTile).not.toHaveBeenCalled();
    expect(result.current.canyonGeometry).not.toBeNull();
  });

  it('waits for the worker tile, then mounts its buffers', async () => {
    live = proxy;
    let answer: (r: SimTileResult) => void = () => {};
    proxy.requestTile.mockImplementation((spec) => new Promise((resolve) => {
      answer = (r) => resolve(r);
      void spec;
    }));
    const { result } = renderStable({ buildAhead: true });
    expect(result.current.canyonGeometry).toBeNull();
    expect(result.current.collisionGeometry).toBeNull();
    expect(proxy.requestTile).toHaveBeenCalledTimes(1);

    const meshes = buildSegmentMeshBuffers(contextFromSpec(proxy.requestTile.mock.calls[0][0]));
    await act(async () => answer({ seq: 1, meshes, buildMicros: 1 }));
    expect(result.current.source).toBe('worker');
    expect(result.current.canyonGeometry!.attributes.position.array).toBe(meshes.canyon!.attributes.position.array);
    expect(result.current.waterGeometry).not.toBeNull();
  });

  it('falls back to the main thread when the worker answers without meshes', async () => {
    live = proxy;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    proxy.requestTile.mockResolvedValue({ seq: 1, meshes: null, error: 'boom', buildMicros: 0 });
    const { result } = renderStable({ buildAhead: true });
    await waitFor(() => expect(result.current.canyonGeometry).not.toBeNull());
    expect(result.current.source).toBe('main');
  });

  it('falls back when the worker died (null answer)', async () => {
    live = proxy;
    proxy.requestTile.mockResolvedValue(null);
    const { result } = renderStable({ buildAhead: true });
    await waitFor(() => expect(result.current.canyonGeometry).not.toBeNull());
    expect(result.current.source).toBe('main');
  });
});
