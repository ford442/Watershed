import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLevel } from './useLevel';
// lumber_flume, not the meander: the meander's pre-roll segments (index < 0) make
// normalizeLevelData sample the curve at t < 0, which throws (a finding, not fixed here).
import lumberLevel from '../maps/lumber_flume.json';

/** A copy with one schema violation (difficulty above 1). */
function invalidLumber(): unknown {
  const doc = structuredClone(lumberLevel) as { segments: Array<{ difficulty: number }> };
  doc.segments[0].difficulty = 5;
  return doc;
}

describe('useLevel — levelData / rawDocument', () => {
  it('carries the validated LevelData on success, the same document in the raw slot', async () => {
    const { result } = renderHook(() => useLevel());
    const doc = structuredClone(lumberLevel);
    let ok = false;
    await act(async () => {
      ok = await result.current.loadFromJSON(doc, 'useLevel-test-valid');
    });
    expect(ok).toBe(true);
    expect(result.current.loadingState).toBe('loaded');
    expect(result.current.levelData).toBe(doc);
    expect(result.current.rawDocument).toBe(doc);
    expect(result.current.levelData?.metadata.name).toBe(lumberLevel.metadata.name);
    result.current.clearCache();
  });

  it('keeps levelData null and the invalid document in the raw slot on failure', async () => {
    const { result } = renderHook(() => useLevel());
    const doc = invalidLumber();
    await act(async () => {
      await result.current.loadFromJSON(doc);
    });
    expect(result.current.loadingState).toBe('error');
    expect(result.current.levelData).toBeNull();
    expect(result.current.rawDocument).toBe(doc);
    expect(result.current.validationResult?.valid).toBe(false);
  });

  it('reloadCurrent after a failed load retries the same document', async () => {
    const { result } = renderHook(() => useLevel());
    const doc = invalidLumber();
    await act(async () => {
      await result.current.loadFromJSON(doc);
    });
    expect(result.current.loadingState).toBe('error');

    let retried = true;
    await act(async () => {
      retried = await result.current.reloadCurrent();
    });
    // The retry ran (it re-validated and failed again) rather than returning
    // early for want of a document.
    expect(retried).toBe(false);
    expect(result.current.loadingState).toBe('error');
    expect(result.current.rawDocument).toBe(doc);
    expect(result.current.validationResult?.valid).toBe(false);
    expect(result.current.error).toMatch(/difficulty/);
  });

  it('reloadCurrent with nothing loaded does nothing', async () => {
    const { result } = renderHook(() => useLevel());
    let retried = true;
    await act(async () => {
      retried = await result.current.reloadCurrent();
    });
    expect(retried).toBe(false);
    expect(result.current.loadingState).toBe('idle');
  });

  it('defaults the segment config at the read site, never in the document', async () => {
    const { result } = renderHook(() => useLevel());
    const doc = structuredClone(lumberLevel);
    await act(async () => {
      await result.current.loadFromJSON(doc, 'useLevel-test-defaults');
    });
    const state = result.current.normalizedState;
    expect(state).not.toBeNull();
    for (const seg of state!.initialSegments) {
      expect(typeof seg.type).toBe('string');
    }
    // The authored segments are handed through as authored.
    expect(state!.segments).toBe(doc.segments);
    result.current.clearCache();
  });
});
