/**
 * runSession.journey.test.ts — Journey mode map stack + survival continuity.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceRunSessionMap,
  getRunMap,
  getRunSession,
  initRunSession,
  resetRunSessionForTests,
  saveJourneyCheckpoint,
  stepRunSurvival,
} from './runSession';
import { ACTIVE_MAP_ID } from '../../maps/registry';

describe('runSession journey mode', () => {
  beforeEach(() => {
    resetRunSessionForTests();
  });

  it('getRunMap follows the session map, and falls back to the code default with none', () => {
    expect(getRunMap().id).toBe(ACTIVE_MAP_ID);
    initRunSession({ mapId: 'meander' });
    expect(getRunMap().id).toBe('meander');
    advanceRunSessionMap('hydro');
    expect(getRunMap().id).toBe('hydro');
  });

  it('builds a campaign stack when journeyMode is journey', () => {
    const session = initRunSession({ mapId: 'glacial', journeyMode: 'journey' });
    expect(session.journeyMode).toBe('journey');
    expect(session.mapStack[0]).toBe('glacial');
    expect(session.mapStack).toContain('meander');
    expect(session.mapStack).toContain('hydro');
    expect(session.mapStack[session.mapStack.length - 1]).toBe('delta');
    expect(session.mapId).toBe('glacial');
  });

  it('preserves survival wetness/exposure across advanceRunSessionMap', () => {
    initRunSession({ mapId: 'hydro', journeyMode: 'journey', launchHour: 10 });
    stepRunSurvival({
      dt: 2,
      biomeId: 'hydroDam',
      inWater: true,
      windSpeed: 1,
    });
    const before = getRunSession()!.survival;
    expect(before.wetness).toBeGreaterThan(0);

    advanceRunSessionMap('delta', { score: 1200, segmentIndex: 16 });
    const after = getRunSession()!;
    expect(after.mapId).toBe('delta');
    expect(after.survival.wetness).toBeCloseTo(before.wetness);
    expect(after.survival.coreTemp).toBeCloseTo(before.coreTemp);
    expect(after.cumulativeScore).toBe(1200);
    expect(after.lastCheckpoint?.mapId).toBe('delta');
  });

  it('autosaves a boundary checkpoint without changing map', () => {
    initRunSession({ mapId: 'meander', journeyMode: 'single' });
    const cp = saveJourneyCheckpoint({ segmentIndex: 38, score: 500 });
    expect(cp).not.toBeNull();
    expect(getRunSession()!.lastCheckpoint?.score).toBe(500);
    expect(getRunSession()!.mapId).toBe('meander');
  });
});
