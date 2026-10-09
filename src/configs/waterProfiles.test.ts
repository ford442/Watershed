import { describe, expect, it } from 'vitest';
import { BIOME_IDS, WATER_PROFILES, getWaterProfile } from './biomes';

describe('WATER_PROFILES (#465 C1)', () => {
  it('has an authored profile for every BiomeId — no fallback', () => {
    for (const id of BIOME_IDS) {
      const profile = WATER_PROFILES[id];
      expect(profile, id).toBeDefined();
      expect(profile.flowMultiplier, id).toBeGreaterThan(0);
      expect(profile.waterColor, id).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(Object.keys(WATER_PROFILES).sort()).toEqual([...BIOME_IDS].sort());
  });

  it('keeps the authored flow multipliers the legacy keys used to lose', () => {
    expect(WATER_PROFILES.slotCanyon.flowMultiplier).toBe(1.4);
    expect(WATER_PROFILES.glacialMelt.flowMultiplier).toBe(1.2);
    expect(WATER_PROFILES.lumberFlume.flowMultiplier).toBe(1.8);
    expect(WATER_PROFILES.lumberFlume.shaderId).toBe('flume-turbulent-v1');
  });

  it('resolves legacy aliases at the boundary', () => {
    expect(getWaterProfile('glacial')).toBe(WATER_PROFILES.glacialMelt);
    expect(getWaterProfile('slot')).toBe(WATER_PROFILES.slotCanyon);
  });
});
