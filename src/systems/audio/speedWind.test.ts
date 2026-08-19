/**
 * speedWind.test.ts — Pure speed → wind gain / cutoff mapping
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEED_WIND,
  mapSpeedToWind,
  sanitizeAudioGain,
  sanitizeCutoffHz,
} from './speedWind';

describe('mapSpeedToWind', () => {
  it('is silent at rest and for non-finite speeds', () => {
    expect(mapSpeedToWind(0).gain).toBe(0);
    expect(mapSpeedToWind(-3).gain).toBe(0);
    expect(mapSpeedToWind(NaN).gain).toBe(0);
    expect(mapSpeedToWind(Infinity).gain).toBe(0);
    expect(mapSpeedToWind(0).cutoffHz).toBe(DEFAULT_SPEED_WIND.cutoffAtRest);
  });

  it('stays silent below startSpeed', () => {
    const result = mapSpeedToWind(DEFAULT_SPEED_WIND.startSpeed - 0.1);
    expect(result.gain).toBe(0);
  });

  it('ramps gain smoothly between start and full speed', () => {
    const low = mapSpeedToWind(4);
    const mid = mapSpeedToWind(12);
    const high = mapSpeedToWind(DEFAULT_SPEED_WIND.fullSpeed);
    expect(low.gain).toBeGreaterThan(0);
    expect(mid.gain).toBeGreaterThan(low.gain);
    expect(high.gain).toBe(1);
    expect(high.gain).toBeLessThanOrEqual(1);
  });

  it('brightens the lowpass cutoff as speed increases', () => {
    const slow = mapSpeedToWind(3);
    const fast = mapSpeedToWind(20);
    expect(fast.cutoffHz).toBeGreaterThan(slow.cutoffHz);
    expect(fast.cutoffHz).toBeLessThanOrEqual(DEFAULT_SPEED_WIND.cutoffAtFull);
  });

  it('never returns non-finite gain or cutoff', () => {
    for (const speed of [NaN, Infinity, -Infinity, -1, 0, 1, 50, 1e9]) {
      const result = mapSpeedToWind(speed);
      expect(Number.isFinite(result.gain)).toBe(true);
      expect(Number.isFinite(result.cutoffHz)).toBe(true);
      expect(result.gain).toBeGreaterThanOrEqual(0);
      expect(result.gain).toBeLessThanOrEqual(1);
    }
  });
});

describe('sanitizeAudioGain / sanitizeCutoffHz', () => {
  it('clamps and rejects non-finite gains', () => {
    expect(sanitizeAudioGain(NaN)).toBe(0);
    expect(sanitizeAudioGain(Infinity)).toBe(0);
    expect(sanitizeAudioGain(-0.5)).toBe(0);
    expect(sanitizeAudioGain(1.5)).toBe(1);
    expect(sanitizeAudioGain(0.4)).toBe(0.4);
  });

  it('clamps cutoff into a safe audible band', () => {
    expect(sanitizeCutoffHz(NaN, 400)).toBe(400);
    expect(sanitizeCutoffHz(0, 400)).toBe(400);
    expect(sanitizeCutoffHz(5, 400)).toBe(20);
    expect(sanitizeCutoffHz(50000, 400)).toBe(20000);
    expect(sanitizeCutoffHz(1200, 400)).toBe(1200);
  });
});
