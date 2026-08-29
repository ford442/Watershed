import { describe, expect, it } from 'vitest';
import { buildGhostHydroFairness, describeHydroFairnessMismatch, describeHydroSplitBlame } from './hydroFairness';
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
    const copy = describeHydroFairnessMismatch(self, rival, 'rival');
    expect(copy).toMatch(/H06:00/);
    expect(copy).toMatch(/H14:00/);
    expect(copy).toMatch(/hydro/);
  });

  it('blames a lost split on the dam pulse segment', () => {
    const copy = describeHydroSplitBlame(
      [
        { segmentIndex: 2, deltaMs: 200 },
        { segmentIndex: 4, deltaMs: 1400 },
      ],
      [PULSE],
      14,
    );
    expect(copy).toBe('you lost 1.4s at hydro-dam-pulse, not at the shelf');
  });
});
