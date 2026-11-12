import { describe, expect, it } from 'vitest';
import { buildGhostHydroFairness, hydroFairnessMismatch, hydroSplitBlame } from './hydroFairness';
import type { HydroEvent } from '../water/hydroEvents';

const PULSE: HydroEvent = {
  id: 'hydro-dam-pulse',
  kind: 'inflowPulse',
  segmentIndex: 4,
  hours: [14],
};

describe('hydroFairness', () => {
  it('labels launch hour and event hash when they differ', () => {
    const self = buildGhostHydroFairness({ launchHour: 6, events: [PULSE], qualityPreset: 'high' });
    const rival = buildGhostHydroFairness({ launchHour: 14, events: [PULSE], qualityPreset: 'high' });
    const diffs = hydroFairnessMismatch(self, rival);
    expect(diffs).toContainEqual({ field: 'launch', self: 6, other: 14 });
    expect(diffs?.some((d) => d.field === 'hydro')).toBe(true);
    expect(hydroFairnessMismatch(self, self)).toBeNull();
  });

  it('blames a lost split on the dam pulse segment', () => {
    const blame = hydroSplitBlame(
      [
        { segmentIndex: 2, deltaMs: 200 },
        { segmentIndex: 4, deltaMs: 1400 },
      ],
      [PULSE],
      14,
    );
    expect(blame).toEqual({ eventId: 'hydro-dam-pulse', kind: 'inflowPulse', seconds: 1.4 });
  });
});
