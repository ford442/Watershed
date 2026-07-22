/**
 * campaign.test.ts — Pure helpers for map resolver + journey continuation.
 */

import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  getContinuationTarget,
  getJourneyCompletionDecision,
  isMapRegistryId,
  isMapUnlocked,
  listMapsForMenu,
  parseUrlMapId,
  resolveMapId,
} from './campaign';

describe('resolveMapId', () => {
  it('prefers explicit selection over URL and last played', () => {
    expect(
      resolveMapId({
        selection: 'delta',
        urlMap: 'glacial',
        lastPlayed: 'meander',
        fallback: 'meander',
      }),
    ).toBe('delta');
  });

  it('uses URL when selection is absent', () => {
    expect(resolveMapId({ urlMap: 'glacial', lastPlayed: 'delta' })).toBe('glacial');
  });

  it('uses last played when selection and URL are absent', () => {
    expect(resolveMapId({ lastPlayed: 'delta' })).toBe('delta');
  });

  it('ignores invalid ids and falls back', () => {
    expect(
      resolveMapId({
        selection: 'not-a-map',
        urlMap: 'also-bad',
        lastPlayed: 'still-bad',
        fallback: 'meander',
      }),
    ).toBe('meander');
  });
});

describe('parseUrlMapId', () => {
  it('parses valid map query values', () => {
    expect(parseUrlMapId('?map=glacial')).toBe('glacial');
    expect(parseUrlMapId('map=delta&seed=1')).toBe('delta');
  });

  it('returns null for missing or invalid map', () => {
    expect(parseUrlMapId('?seed=1')).toBeNull();
    expect(parseUrlMapId('?map=creek')).toBeNull();
  });
});

describe('getJourneyCompletionDecision', () => {
  it('continues glacial into meander via registry continuation', () => {
    expect(getJourneyCompletionDecision('glacial')).toEqual({
      kind: 'continue',
      nextMapId: 'meander',
      nextLabel: 'Meander to Waterfall',
    });
    expect(getContinuationTarget('glacial')).toBe('meander');
  });

  it('continues meander into delta via nextMapId', () => {
    expect(getJourneyCompletionDecision('meander')).toEqual({
      kind: 'continue',
      nextMapId: 'delta',
      nextLabel: 'Delta Rapids',
    });
  });

  it('shows summary for the final map', () => {
    expect(getJourneyCompletionDecision('delta')).toEqual({ kind: 'summary' });
    expect(getContinuationTarget('delta')).toBeNull();
  });
});

describe('campaign menu helpers', () => {
  it('lists all registered maps with duration and difficulty', () => {
    const maps = listMapsForMenu();
    expect(maps.map((m) => m.id)).toEqual(['glacial', 'meander', 'delta']);
    expect(maps[0].estimatedDurationSec).toBe(240);
    expect(maps[0].difficulty).toBe('intermediate');
    expect(formatDuration(240)).toBe('~4 min');
  });

  it('soft-locks maps until prerequisites are completed', () => {
    expect(isMapUnlocked('glacial', [])).toBe(true);
    expect(isMapUnlocked('meander', [])).toBe(false);
    expect(isMapUnlocked('meander', ['glacial'])).toBe(true);
    expect(isMapUnlocked('delta', ['glacial'])).toBe(false);
    expect(isMapUnlocked('delta', ['meander'])).toBe(true);
  });

  it('type-guards registry ids', () => {
    expect(isMapRegistryId('glacial')).toBe(true);
    expect(isMapRegistryId('nope')).toBe(false);
  });
});
