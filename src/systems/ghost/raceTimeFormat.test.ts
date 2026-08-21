import { describe, expect, it } from 'vitest';
import { formatRaceTimeMs } from './raceTimeFormat';

describe('formatRaceTimeMs', () => {
  it('formats zero', () => {
    expect(formatRaceTimeMs(0)).toBe('0:00.00');
  });

  it('formats sub-minute times', () => {
    expect(formatRaceTimeMs(12_340)).toBe('0:12.34');
  });

  it('formats minutes', () => {
    expect(formatRaceTimeMs(75_000)).toBe('1:15.00');
  });

  it('rounds to centiseconds', () => {
    expect(formatRaceTimeMs(1_005)).toBe('0:01.01');
  });

  it('clamps negative/NaN input to zero', () => {
    expect(formatRaceTimeMs(-500)).toBe('0:00.00');
    expect(formatRaceTimeMs(NaN)).toBe('0:00.00');
  });
});
