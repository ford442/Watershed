import { describe, it, expect, beforeEach } from 'vitest';
import {
  WETNESS_CUTOFF_DRY,
  WETNESS_CUTOFF_SOAKED,
  WETNESS_MUFFLE_FLOOR,
  currentWetnessMuffle,
  getSfxWetnessMultiplier,
  resetWetnessMuffle,
  setSfxWetnessMultiplier,
  wetnessMuffleParams,
} from './wetnessMuffle';
import { createSurvivalState, getLoadoutDefinition, getSurvivalModifiers } from '../survival';

describe('wetnessMuffleParams', () => {
  it('is transparent when dry', () => {
    const dry = wetnessMuffleParams(1);
    expect(dry.gain).toBe(1);
    expect(dry.wet).toBe(0);
    expect(dry.cutoffHz).toBe(WETNESS_CUTOFF_DRY);
  });

  it('ducks and darkens as the multiplier falls', () => {
    const soaked = wetnessMuffleParams(WETNESS_MUFFLE_FLOOR);
    expect(soaked.gain).toBeCloseTo(WETNESS_MUFFLE_FLOOR, 6);
    expect(soaked.wet).toBeCloseTo(1, 6);
    expect(soaked.cutoffHz).toBeCloseTo(WETNESS_CUTOFF_SOAKED, 6);

    const half = wetnessMuffleParams((1 + WETNESS_MUFFLE_FLOOR) / 2);
    expect(half.gain).toBeGreaterThan(soaked.gain);
    expect(half.gain).toBeLessThan(1);
    expect(half.cutoffHz).toBeGreaterThan(soaked.cutoffHz);
    expect(half.cutoffHz).toBeLessThan(WETNESS_CUTOFF_DRY);
  });

  it('treats a missing / non-finite tick as dry, never as silence', () => {
    expect(wetnessMuffleParams(Number.NaN).gain).toBe(1);
    expect(wetnessMuffleParams(Number.POSITIVE_INFINITY).gain).toBe(1);
  });

  it('clamps outside the survival range', () => {
    expect(wetnessMuffleParams(0).gain).toBe(WETNESS_MUFFLE_FLOOR);
    expect(wetnessMuffleParams(4).gain).toBe(1);
  });
});

describe('wetness muffle bus', () => {
  beforeEach(() => resetWetnessMuffle());

  it('round-trips the survival modifier the tick derives', () => {
    const loadout = getLoadoutDefinition('balanced');
    const soaked = getSurvivalModifiers({ ...createSurvivalState(), wetness: 1 }, 'canyonSummer', loadout);

    setSfxWetnessMultiplier(soaked.sfxWetnessMultiplier);

    expect(getSfxWetnessMultiplier()).toBeCloseTo(soaked.sfxWetnessMultiplier, 6);
    expect(currentWetnessMuffle().gain).toBeLessThan(1);
    expect(currentWetnessMuffle().cutoffHz).toBeLessThan(WETNESS_CUTOFF_DRY);
  });

  it('resets to an open mix', () => {
    setSfxWetnessMultiplier(WETNESS_MUFFLE_FLOOR);
    resetWetnessMuffle();
    expect(currentWetnessMuffle().gain).toBe(1);
  });
});
