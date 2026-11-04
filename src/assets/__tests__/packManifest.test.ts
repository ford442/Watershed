import { describe, expect, it } from 'vitest';
import { packBaseUrl, packFileUrl, parsePackManifest } from '../packManifest';
import { readCommittedManifest } from './packFixtures';

const committed = () => structuredClone(readCommittedManifest('core')) as Record<string, unknown>;
const hull = (m: Record<string, unknown>) =>
  (m.assets as Record<string, Record<string, unknown>>)['raft.hull.default'] as Record<string, unknown>;

describe('pack manifest', () => {
  it('reads the committed core manifest: the raft hull with its baked LOD ladder', () => {
    const manifest = parsePackManifest(committed(), 'core');
    expect(manifest.stamp).toMatch(/^[0-9a-f]{16}$/);
    const entry = manifest.assets['raft.hull.default'];
    expect(entry).toBeDefined();
    expect(entry?.file).toBe('raft.hull.default.glb');
    expect(entry?.lods.length).toBeGreaterThanOrEqual(2);
    expect(entry?.lods[0]?.distance).toBe(0);
    // Each baked level has fewer triangles than the one before it.
    const tris = entry?.lods.map((l) => l.triangles) ?? [];
    for (let i = 1; i < tris.length; i += 1) expect(tris[i]).toBeLessThan(tris[i - 1] as number);
  });

  it('keeps the authored hull on the physics box (2 × 0.3 × 3 m, origin at the centre)', () => {
    const { bounds } = parsePackManifest(committed(), 'core').assets['raft.hull.default']!;
    expect(bounds.max[0] - bounds.min[0]).toBeGreaterThan(1.8);
    expect(bounds.max[0] - bounds.min[0]).toBeLessThan(2.3);
    expect(bounds.max[2] - bounds.min[2]).toBeGreaterThan(2.7);
    expect(bounds.max[2] - bounds.min[2]).toBeLessThan(3.3);
    expect(bounds.min[1]).toBeGreaterThan(-0.3);
    expect(bounds.max[1]).toBeLessThan(0.45);
    for (const c of bounds.center) expect(Math.abs(c)).toBeLessThan(0.1);
  });

  it('rejects a manifest for another pack or another schema', () => {
    expect(() => parsePackManifest({ ...committed(), schema: 2 }, 'core')).toThrow(/schema 2/);
    expect(() => parsePackManifest({ ...committed(), pack: 'glacial' }, 'core')).toThrow(/expected 'core'/);
    expect(() => parsePackManifest({ ...committed(), stamp: 'xyz' }, 'core')).toThrow(/stamp/);
    expect(() => parsePackManifest(null, 'core')).toThrow();
  });

  it('rejects a file name that is not a bare .glb in the pack directory', () => {
    for (const file of ['../index.html', 'sub/dir.glb', 'raft.hull.default.gltf', '']) {
      const m = committed();
      hull(m).file = file;
      expect(() => parsePackManifest(m, 'core')).toThrow(/file/);
    }
  });

  it('rejects a LOD ladder that does not start at 0 or does not increase', () => {
    const m1 = committed();
    hull(m1).lods = [{ distance: 5, triangles: 10 }];
    expect(() => parsePackManifest(m1, 'core')).toThrow(/distances/);
    const m2 = committed();
    hull(m2).lods = [{ distance: 0, triangles: 10 }, { distance: 0, triangles: 5 }];
    expect(() => parsePackManifest(m2, 'core')).toThrow(/distances/);
    const m3 = committed();
    hull(m3).lods = [];
    expect(() => parsePackManifest(m3, 'core')).toThrow(/non-empty/);
  });

  it('stamps every pack file URL with the manifest stamp, under the deploy base', () => {
    const manifest = parsePackManifest(committed(), 'core');
    expect(packBaseUrl('core', './')).toBe('./packs/core/');
    expect(packBaseUrl('core', '/watershed')).toBe('/watershed/packs/core/');
    expect(packFileUrl(manifest, 'raft.hull.default.glb', './')).toBe(
      `./packs/core/raft.hull.default.glb?v=${manifest.stamp}`,
    );
  });
});
