/**
 * ReachStreamer.preloadReach order of operations (#503 F): the manifest is
 * fetched and validated before any asset request; an invalid manifest fetches
 * nothing and caches nothing; a failing asset is reported, not fatal; the
 * manifest is cached only once every asset has settled; eviction drops it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReachStreamer } from './ReachStreamer';
import { AssetCache } from './reachAssetCache';

const reach = (shaders: Array<{ id: string; url: string }>) => ({
  reachId: 'order-reach',
  metadata: { name: 'Order', author: 'Test', difficulty: 'beginner', estimatedDuration: 60, version: '1.0.0' },
  world: {
    track: { waypoints: [[0, 0, 0], [0, -5, -30], [10, -10, -80], [-5, -15, -140]], segmentLength: 30, totalSegments: 3 },
    biome: {
      baseType: 'canyonSummer',
      sky: { color: '#87CEEB' },
      fog: { color: '#D4E9F7', near: 50, far: 200 },
      lighting: { sunIntensity: 1.4, sunAngle: 45 },
      water: { tint: '#1a6b8a', flowSpeed: 1.0 },
    },
  },
  segments: [0, 1, 2].map((index) => ({ index, difficulty: 0.3, decorations: { trees: 4 } })),
  spawns: { start: { position: [0, -4, 5] } },
  requiredAssets: { textures: [], models: [], audio: [], shaders },
  transition: { segmentIndex: 2, type: 'waterfall', durationSeconds: 5 },
});

type Respond = (url: string) => { ok: boolean; status?: number; json?: unknown; text?: string };

function mockFetch(respond: Respond): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const r = respond(url);
    // The manifest is only "cached" (visible to isReachCached) after the
    // assets settle — record the cache state at each asset request.
    if (!url.endsWith('/manifest')) calls.push(`cached=${ReachStreamer.isReachCached('order-reach')}`);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.ok ? 'OK' : 'ERR',
      json: async () => r.json,
      text: async () => r.text ?? '',
    };
  }));
  return calls;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (ReachStreamer.isReachCached('order-reach')) ReachStreamer.evictReach('order-reach');
  AssetCache.shaders.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ReachStreamer.preloadReach', () => {
  it('fetches the manifest first, then the assets, and caches the manifest last', async () => {
    const manifest = reach([{ id: 'a', url: 'a.glsl' }, { id: 'b', url: 'b.glsl' }]);
    const calls = mockFetch((url) => (url.endsWith('/manifest') ? { ok: true, json: manifest } : { ok: true, text: 'void main(){}' }));

    const result = await ReachStreamer.preloadReach('order-reach');

    expect(calls[0]).toMatch(/\/order-reach\/manifest$/);
    const assetCalls = calls.filter((c) => c.endsWith('.glsl'));
    expect(assetCalls).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('cached='))).toEqual(['cached=false', 'cached=false']);
    expect(ReachStreamer.isReachCached('order-reach')).toBe(true);
    expect(result.loaded.shaders).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('an invalid manifest fetches no asset and caches nothing', async () => {
    const bad = { ...reach([{ id: 'a', url: 'a.glsl' }]), metadata: undefined };
    const calls = mockFetch((url) => (url.endsWith('/manifest') ? { ok: true, json: bad } : { ok: true, text: '' }));

    await expect(ReachStreamer.preloadReach('order-reach')).rejects.toThrow(/Invalid Reach manifest/);
    expect(calls).toHaveLength(1);
    expect(ReachStreamer.isReachCached('order-reach')).toBe(false);
  });

  it('a failing asset is reported but does not fail the preload; evict drops the reach', async () => {
    const manifest = reach([{ id: 'ok', url: 'ok.glsl' }, { id: 'gone', url: 'gone.glsl' }]);
    mockFetch((url) => {
      if (url.endsWith('/manifest')) return { ok: true, json: manifest };
      return url.endsWith('gone.glsl') ? { ok: false, status: 404 } : { ok: true, text: 'void main(){}' };
    });

    const result = await ReachStreamer.preloadReach('order-reach');

    expect(result.loaded.shaders).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/gone\.glsl/);
    expect(ReachStreamer.isReachCached('order-reach')).toBe(true);

    ReachStreamer.evictReach('order-reach');
    expect(ReachStreamer.isReachCached('order-reach')).toBe(false);
    expect(AssetCache.shaders.size).toBe(0);
  });
});
