/**
 * Guard: reflection pass must only mount when a live consumer samples the RT
 * (FlowingWater), and every LOD quality that enables reflections requires that consumer.
 */
import { describe, expect, test } from 'vitest';
import { QUALITY_SETTINGS } from '../LODManager';
import { FLOWING_WATER_SAMPLES_REFLECTION } from '../../components/FlowingWater';

describe('waterReflectionWiring', () => {
  test('FlowingWater declares a live reflectionTexture consumer', () => {
    expect(FLOWING_WATER_SAMPLES_REFLECTION).toBe(true);
  });

  test('every quality with enableReflections has a FlowingWater consumer (XOR invariant)', () => {
    const qualities = Object.entries(QUALITY_SETTINGS) as [
      string,
      (typeof QUALITY_SETTINGS)[keyof typeof QUALITY_SETTINGS],
    ][];

    for (const [name, config] of qualities) {
      if (config.enableReflections) {
        expect(
          FLOWING_WATER_SAMPLES_REFLECTION,
          `${name}: enableReflections requires FLOWING_WATER_SAMPLES_REFLECTION`,
        ).toBe(true);
        expect(config.reflectionResolution).toBeGreaterThan(0);
        expect(config.reflectionUpdateInterval).toBeGreaterThan(0);
        expect(config.reflectionStrength).toBeGreaterThan(0);
      } else {
        expect(config.reflectionStrength).toBe(0);
      }
    }
  });

  test('high uses 512/3 and ultra uses 1024/2 reflection budgets', () => {
    expect(QUALITY_SETTINGS.high.enableReflections).toBe(true);
    expect(QUALITY_SETTINGS.high.reflectionResolution).toBe(512);
    expect(QUALITY_SETTINGS.high.reflectionUpdateInterval).toBe(3);

    expect(QUALITY_SETTINGS.ultra.enableReflections).toBe(true);
    expect(QUALITY_SETTINGS.ultra.reflectionResolution).toBe(1024);
    expect(QUALITY_SETTINGS.ultra.reflectionUpdateInterval).toBe(2);

    expect(QUALITY_SETTINGS.low.enableReflections).toBe(false);
    expect(QUALITY_SETTINGS.medium.enableReflections).toBe(false);
  });
});
