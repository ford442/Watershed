import { describe, expect, it } from 'vitest';
import { parseLaunchHourOverride } from './launchHourOverride';

describe('launchHourOverride', () => {
  it('reads the scouting hours', () => {
    expect(parseLaunchHourOverride('?hour=6')).toBe(6);
    expect(parseLaunchHourOverride('map=hydro&hour=14')).toBe(14);
  });

  it('ignores absent, malformed and out-of-range values', () => {
    expect(parseLaunchHourOverride('')).toBeNull();
    expect(parseLaunchHourOverride('?map=hydro')).toBeNull();
    expect(parseLaunchHourOverride('?hour=')).toBeNull();
    expect(parseLaunchHourOverride('?hour=noon')).toBeNull();
    expect(parseLaunchHourOverride('?hour=24')).toBeNull();
    expect(parseLaunchHourOverride('?hour=-1')).toBeNull();
  });
});
