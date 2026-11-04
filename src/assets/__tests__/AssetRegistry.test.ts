import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { LoadedPack, PackAsset } from '../AssetPack';

const loadPack = vi.fn<(id: string) => Promise<LoadedPack>>();
vi.mock('../AssetPack', () => ({ loadPack: (id: string) => loadPack(id) }));

const { getAsset, getAssetStatus, instantiateAsset, requestAsset, resetAssetRegistry, subscribeAssets } = await import(
  '../AssetRegistry'
);

afterEach(() => {
  resetAssetRegistry();
  loadPack.mockReset();
});

function fakeAsset(): PackAsset {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff' });
  const level = (tris: number) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BufferGeometry().setIndex(Array.from({ length: tris * 3 }, () => 0)), material));
    return g;
  };
  return {
    name: 'raft.hull.default',
    entry: {
      file: 'raft.hull.default.glb',
      bytes: 1,
      sha256: '0'.repeat(64),
      sourceSha256: '0'.repeat(64),
      bounds: { min: [0, 0, 0], max: [1, 1, 1], center: [0.5, 0.5, 0.5], radius: 1 },
      lods: [
        { distance: 0, triangles: 8 },
        { distance: 14, triangles: 4 },
      ],
      textures: false,
    },
    levels: [level(8), level(4)],
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AssetRegistry', () => {
  it('starts the owning pack once, then answers with the decoded asset', async () => {
    const asset = fakeAsset();
    loadPack.mockResolvedValue({ manifest: {} as LoadedPack['manifest'], assets: new Map([[asset.name, asset]]) });
    const seen = vi.fn();
    subscribeAssets(seen);

    expect(getAsset('raft.hull.default')).toBeNull();
    requestAsset('raft.hull.default');
    requestAsset('raft.hull.default');
    expect(loadPack).toHaveBeenCalledTimes(1);
    expect(loadPack).toHaveBeenCalledWith('core');
    expect(getAssetStatus('raft.hull.default')).toBe('loading');
    await flush();
    expect(getAssetStatus('raft.hull.default')).toBe('ready');
    expect(getAsset('raft.hull.default')).toBe(asset);
    expect(seen).toHaveBeenCalled();
  });

  it('keeps the primitive (null) when the pack fails, and retries on the next request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadPack.mockRejectedValueOnce(new Error('offline'));
    requestAsset('raft.hull.default');
    await flush();
    expect(getAssetStatus('raft.hull.default')).toBe('failed');
    expect(getAsset('raft.hull.default')).toBeNull();

    const asset = fakeAsset();
    loadPack.mockResolvedValueOnce({ manifest: {} as LoadedPack['manifest'], assets: new Map([[asset.name, asset]]) });
    requestAsset('raft.hull.default');
    await flush();
    expect(getAsset('raft.hull.default')).toBe(asset);
    warn.mockRestore();
  });

  it('instantiates a THREE.LOD over the baked levels, at the manifest distances', () => {
    const asset = fakeAsset();
    const instance = instantiateAsset(asset, { castShadow: true, receiveShadow: true });
    const lod = instance.object as THREE.LOD;
    expect(lod.isLOD).toBe(true);
    expect(lod.levels.map((l) => l.distance)).toEqual([0, 14]);
    expect(instance.source).toBe('pack');
    lod.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) expect((child as THREE.Mesh).castShadow).toBe(true);
    });
  });

  it('gives each instance its own material, so a tint never bleeds into the pack or a sibling', () => {
    const asset = fakeAsset();
    const a = instantiateAsset(asset);
    const b = instantiateAsset(asset);
    expect(a.tintMaterial).not.toBeNull();
    a.tintMaterial!.color.setScalar(0.25);
    const packMaterial = (asset.levels[0]!.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(packMaterial.color.r).toBe(1);
    expect(b.tintMaterial!.color.r).toBe(1);
    expect(a.dryColor.r).toBe(1);
    // Both levels share the one cloned material: the tint darkens whichever level is drawn.
    const levelMaterials = (a.object as THREE.LOD).levels.map((l) => (l.object.children[0] as THREE.Mesh).material);
    expect(levelMaterials[0]).toBe(levelMaterials[1]);

    const dispose = vi.spyOn(a.tintMaterial!, 'dispose');
    a.dispose();
    expect(dispose).toHaveBeenCalled();
  });
});
