/**
 * spawnTiming — the `?spawnProfile=1` user-timing marks (#487 B).
 *
 * `enabled` is captured from queryFlags() when the module loads, so each case sets
 * the query string first and then imports a fresh copy (vi.resetModules). Only the
 * marks' names, keys and call counts are asserted, never a duration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type SpawnTiming = typeof import('./spawnTiming');

const DETAIL = { segmentId: 4, biome: 'canyonSummer', source: 'main' as const, geometryMs: 0 };

async function loadWithQuery(search: string): Promise<SpawnTiming> {
  window.history.replaceState({}, '', `/${search}`);
  vi.resetModules();
  return import('./spawnTiming');
}

function measureNames(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('spawnTiming — disabled (no ?spawnProfile)', () => {
  it('reports disabled, reads no clock and writes no measure', async () => {
    const timing = await loadWithQuery('');
    const measure = vi.spyOn(performance, 'measure');
    const now = vi.spyOn(performance, 'now');

    expect(timing.spawnProfileEnabled()).toBe(false);
    expect(timing.spawnTimingStart()).toBe(0);
    const key = {};
    timing.noteSegmentBuilt(key, 0, DETAIL);
    timing.noteSegmentMounted(key);

    expect(now).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });

  it('ignores ?spawnProfile values other than 1', async () => {
    const timing = await loadWithQuery('?spawnProfile=true');
    expect(timing.spawnProfileEnabled()).toBe(false);
  });
});

describe('spawnTiming — enabled (?spawnProfile=1)', () => {
  it('writes segment-build then segment-mount, once per key', async () => {
    const timing = await loadWithQuery('?spawnProfile=1');
    const measure = vi.spyOn(performance, 'measure').mockImplementation(() => undefined as never);
    expect(timing.spawnProfileEnabled()).toBe(true);

    const key = {};
    const start = timing.spawnTimingStart();
    timing.noteSegmentBuilt(key, start, DETAIL);
    timing.noteSegmentBuilt(key, start, DETAIL); // same key: ignored
    timing.noteSegmentMounted(key);
    timing.noteSegmentMounted(key); // already mounted: ignored

    expect(measureNames(measure)).toEqual(['segment-build', 'segment-mount']);
    const buildOpts = measure.mock.calls[0][1] as { start: number; detail: unknown };
    const mountOpts = measure.mock.calls[1][1] as { start: number; detail: unknown };
    expect(buildOpts.detail).toBe(DETAIL);
    // The mount measure spans from the build's start.
    expect(mountOpts.start).toBe(buildOpts.start);
    expect(mountOpts.detail).toBe(DETAIL);
  });

  it('skips a null key and a mount that was never built', async () => {
    const timing = await loadWithQuery('?spawnProfile=1');
    const measure = vi.spyOn(performance, 'measure').mockImplementation(() => undefined as never);

    timing.noteSegmentBuilt(null, 0, DETAIL);
    timing.noteSegmentBuilt(undefined, 0, DETAIL);
    timing.noteSegmentMounted(null);
    timing.noteSegmentMounted({});

    expect(measure).not.toHaveBeenCalled();
  });

  it('keys by object identity: a recycled slot with a new path measures again', async () => {
    const timing = await loadWithQuery('?spawnProfile=1');
    const measure = vi.spyOn(performance, 'measure').mockImplementation(() => undefined as never);

    const first = {};
    const second = {};
    for (const key of [first, second]) {
      timing.noteSegmentBuilt(key, timing.spawnTimingStart(), DETAIL);
      timing.noteSegmentMounted(key);
    }
    expect(measureNames(measure)).toEqual(['segment-build', 'segment-mount', 'segment-build', 'segment-mount']);
  });
});
