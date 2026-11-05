import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadPack, resetAssetPacks, verifyAssetBytes } from '../AssetPack';
import { parsePackManifest } from '../packManifest';
import { diskFetch, readCommittedManifest } from './packFixtures';

afterEach(() => resetAssetPacks());

function triangles(object: THREE.Object3D): number {
  let tris = 0;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return tris;
}

describe('loadPack', () => {
  it('decodes the committed core pack (meshopt + quantised) into one subtree per baked level', async () => {
    const urls: string[] = [];
    const pack = await loadPack('core', { base: '/', fetchImpl: diskFetch(urls) });
    const hull = pack.assets.get('raft.hull.default');
    expect(hull).toBeDefined();
    expect(hull!.levels).toHaveLength(hull!.entry.lods.length);
    hull!.levels.forEach((level, i) => {
      expect(level.parent).toBeNull();
      expect(triangles(level)).toBe(hull!.entry.lods[i]!.triangles);
    });

    // The decoded LOD0 sits where the manifest says the authored source sits (quantisation
    // moves a vertex by well under a centimetre).
    const box = new THREE.Box3().setFromObject(hull!.levels[0]!);
    const { min, max } = hull!.entry.bounds;
    for (let a = 0; a < 3; a += 1) {
      expect(box.min.getComponent(a)).toBeCloseTo(min[a]!, 2);
      expect(box.max.getComponent(a)).toBeCloseTo(max[a]!, 2);
    }

    // Manifest unstamped (it names the stamp); every .glb stamped with it.
    expect(urls[0]).toBe('/packs/core/manifest.json');
    expect(urls.slice(1)).toEqual([`/packs/core/raft.hull.default.glb?v=${pack.manifest.stamp}`]);
  });

  it('joins a load in flight and forgets a failed one, so the next request retries', async () => {
    const failing = (async () => new Response('gone', { status: 404 })) as typeof fetch;
    await expect(loadPack('core', { fetchImpl: failing })).rejects.toThrow(/HTTP 404/);
    const urls: string[] = [];
    const a = loadPack('core', { base: '/', fetchImpl: diskFetch(urls) });
    const b = loadPack('core', { base: '/', fetchImpl: diskFetch(urls) });
    expect(a).toBe(b);
    await a;
    expect(urls).toHaveLength(2);
  });

  it('refuses bytes that do not match the manifest row (a stale cache, a partial deploy)', async () => {
    const entry = parsePackManifest(readCommittedManifest('core'), 'core').assets['raft.hull.default']!;
    await expect(verifyAssetBytes('x', entry, new ArrayBuffer(entry.bytes - 1))).rejects.toThrow(/manifest says/);
    // Right size, wrong content: caught by the sha256 when crypto.subtle is there.
    if (globalThis.crypto?.subtle) {
      await expect(verifyAssetBytes('x', entry, new ArrayBuffer(entry.bytes))).rejects.toThrow(/sha256/);
    }
  });
});
