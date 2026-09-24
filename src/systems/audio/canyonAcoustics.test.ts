import { describe, expect, it } from 'vitest';
import { TRACK_BIOMES } from '../../configs/TrackBiomes';
import {
  canyonAcousticParams,
  isEnclosedReach,
  wallWetnessForBiome,
} from './canyonAcoustics';

function forBiome(id: keyof typeof TRACK_BIOMES) {
  const t = TRACK_BIOMES[id].wallTightness;
  return { enclosed: isEnclosedReach(t), params: canyonAcousticParams(t, wallWetnessForBiome(id)) };
}

describe('canyonAcoustics', () => {
  it('?map=glacial reads enclosed, ?map=delta reads open', () => {
    const glacial = forBiome('glacialMelt');
    const delta = forBiome('delta');

    expect(glacial.enclosed).toBe(true);
    expect(delta.enclosed).toBe(false);

    expect(glacial.params.taps.length).toBeGreaterThan(0);
    expect(glacial.params.earlyReflectionSend).toBeGreaterThan(0.4);
    expect(delta.params.taps).toEqual([]);
    expect(delta.params.earlyReflectionSend).toBe(0);
    expect(glacial.params.reverbSend).toBeGreaterThan(delta.params.reverbSend);
  });

  it('slot canyon and ice tube both read as enclosed', () => {
    for (const id of ['slotCanyon', 'glacialMelt'] as const) {
      const { enclosed, params } = forBiome(id);
      expect(enclosed).toBe(true);
      expect(params.enclosure).toBeGreaterThan(0.8);
    }
  });

  it('tighter walls give earlier first reflections', () => {
    const open = canyonAcousticParams(0.45);
    const tight = canyonAcousticParams(0.78);
    expect(tight.taps[0].delaySeconds).toBeLessThan(open.taps[0].delaySeconds);
  });

  it('wetter walls reflect more, and brighter', () => {
    const dry = canyonAcousticParams(0.72, 0.2);
    const wet = canyonAcousticParams(0.72, 0.9);
    expect(wet.earlyReflectionSend).toBeGreaterThan(dry.earlyReflectionSend);
    expect(wet.taps[2].gain).toBeGreaterThan(dry.taps[2].gain);
    expect(wet.earlyReflectionLowpassHz).toBeGreaterThan(dry.earlyReflectionLowpassHz);
  });

  it('taps decay and stay stable', () => {
    const { taps } = canyonAcousticParams(1, 1);
    for (let k = 1; k < taps.length; k += 1) {
      expect(taps[k].gain).toBeLessThan(taps[k - 1].gain);
      expect(taps[k].delaySeconds).toBeGreaterThan(taps[k - 1].delaySeconds);
    }
    expect(taps.every((tap) => tap.gain < 1)).toBe(true);
  });

  it('sanitizes garbage input to an open space', () => {
    const p = canyonAcousticParams(Number.NaN, Number.POSITIVE_INFINITY);
    expect(p.enclosure).toBe(0);
    expect(p.taps).toEqual([]);
    expect(isEnclosedReach(Number.NaN)).toBe(false);
    expect(wallWetnessForBiome('not-a-biome')).toBeGreaterThan(0);
  });
});
