import * as THREE from 'three';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTrackBiomeProfile } from '../../../configs/TrackBiomes';
import type { SimTileResult } from '../../../sim/simWorkerProtocol';
import { buildSegmentMeshBuffers, contextFromSpec, type SegmentMeshSpec } from '../../../terrain/segmentMeshBuild';
import { buildSegmentPlacements } from '../../../terrain/placement';
import type { SegmentPlacementInput } from '../../../terrain/placement/inputs';
import { placementInputFor } from './usePlacementData';
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
    await act(async () => answer({ seq: 1, meshes, placements: null, buildMicros: 1 }));
    expect(result.current.source).toBe('worker');
    expect(result.current.canyonGeometry!.attributes.position.array).toBe(meshes.canyon!.attributes.position.array);
    expect(result.current.waterGeometry).not.toBeNull();
  });

  it('falls back to the main thread when the worker answers without meshes', async () => {
    live = proxy;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    proxy.requestTile.mockResolvedValue({ seq: 1, meshes: null, placements: null, error: 'boom', buildMicros: 0 });
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

describe('useGeometries placements ride along (#487 D)', () => {
  const input = (): SegmentPlacementInput => ({
    ...placementInputFor({
      type: 'normal',
      biome: 'canyonSummer',
      biomeProfile: getTrackBiomeProfile('canyonSummer'),
      config: {},
      flowSpeed: 1,
    }),
    mapId: 'meander',
  });

  it('builds the placements here without a worker', () => {
    const { result } = renderStable({ placementInput: input() });
    expect(result.current.placements).toBeInstanceOf(ArrayBuffer);
    expect(result.current.placements!.byteLength).toBeGreaterThan(264);
  });

  it('mounts the worker buffer as is, and sends the placement input with the spec', async () => {
    live = proxy;
    let answer: (r: SimTileResult) => void = () => {};
    proxy.requestTile.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { result } = renderStable({ buildAhead: true, placementInput: input() });
    expect(result.current.placements).toBeNull();
    const spec = proxy.requestTile.mock.calls[0][0];
    expect(spec.placement?.mapId).toBe('meander');
    const ctx = contextFromSpec(spec);
    const placements = buildSegmentPlacements(ctx, spec.placement!);
    await act(async () => answer({ seq: 1, meshes: buildSegmentMeshBuffers(ctx), placements, buildMicros: 1 }));
    expect(result.current.placements).toBe(placements);
  });

  it('builds the placements here when the worker sent meshes without them', async () => {
    live = proxy;
    proxy.requestTile.mockImplementation(async (spec) => ({
      seq: 1,
      meshes: buildSegmentMeshBuffers(contextFromSpec(spec)),
      placements: null,
      buildMicros: 1,
    }));
    const { result } = renderStable({ buildAhead: true, placementInput: input() });
    await waitFor(() => expect(result.current.placements).not.toBeNull());
    expect(result.current.source).toBe('worker');
  });

  it('drops a late reply for the slot\'s previous segment (7 → 17)', async () => {
    live = proxy;
    const answers: ((r: SimTileResult) => void)[] = [];
    proxy.requestTile.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const seg7 = params({ segmentId: 7, buildAhead: true, placementInput: input() });
    const seg17 = params({ segmentId: 17, buildAhead: true, placementInput: input() });
    const { result, rerender } = renderHook((props: UseGeometriesParams) => useGeometries(props), { initialProps: seg7 });
    const spec7 = proxy.requestTile.mock.calls[0][0];
    rerender(seg17);
    expect(proxy.requestTile).toHaveBeenCalledTimes(2);
    const spec17 = proxy.requestTile.mock.calls[1][0];
    expect([spec7.segmentId, spec17.segmentId]).toEqual([7, 17]);

    // Segment 7's tile lands after the slot became segment 17: ignored.
    const stale = buildSegmentPlacements(contextFromSpec(spec7), spec7.placement!);
    await act(async () => answers[0]({ seq: 1, meshes: buildSegmentMeshBuffers(contextFromSpec(spec7)), placements: stale, buildMicros: 1 }));
    expect(result.current.placements).toBeNull();
    expect(result.current.canyonGeometry).toBeNull();

    const fresh = buildSegmentPlacements(contextFromSpec(spec17), spec17.placement!);
    await act(async () => answers[1]({ seq: 2, meshes: buildSegmentMeshBuffers(contextFromSpec(spec17)), placements: fresh, buildMicros: 1 }));
    expect(result.current.placements).toBe(fresh);
    expect(Buffer.from(fresh).equals(Buffer.from(stale))).toBe(false);
  });
});
