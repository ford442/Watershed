/**
 * runSession journey-results helpers for the delta finale.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  getJourneyResultsSummary,
  initRunSession,
  recordUprightDistance,
  resetRunSessionForTests,
  tickRunSurvival,
} from '../runSession';

describe('runSession journey results', () => {
  beforeEach(() => {
    resetRunSessionForTests();
  });

  it('tracks peak wetness and upright distance for results UI', () => {
    initRunSession({ mapId: 'delta', launchHour: 17 });

    tickRunSurvival({
      dt: 2,
      biomeId: 'delta',
      inWater: true,
      windSpeed: 2,
    });
    recordUprightDistance(120.5);

    const summary = getJourneyResultsSummary();
    expect(summary).not.toBeNull();
    expect(summary!.mapId).toBe('delta');
    expect(summary!.launchHour).toBe(17);
    expect(summary!.peakWetness).toBeGreaterThan(0.5);
    expect(summary!.uprightDistanceMeters).toBeCloseTo(120.5, 1);
    expect(summary!.cachesRetrieved).toBe(0);
  });
});
