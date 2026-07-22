/**
 * Canonical BiomeId + legacy alias coverage.
 */

import { vi } from 'vitest';
import {
  BIOME_IDS,
  LEGACY_BIOME_ALIASES,
  normalizeBiomeId,
  isBiomeId,
  DEFAULT_BIOME_ID,
} from '../biomes';
import { getTrackBiomeProfile } from '../TrackBiomes';
import { getBiomePalette } from '../BiomePalettes';
import {
  JSONMapManager,
  type LevelData,
} from '../../systems/MapSystem';

describe('normalizeBiomeId', () => {
  it('maps every legacy alias to its canonical BiomeId', () => {
    const expected: Record<string, string> = {
      summer: 'canyonSummer',
      autumn: 'canyonAutumn',
      'creek-summer': 'canyonSummer',
      'creek-autumn': 'canyonAutumn',
      'alpine-spring': 'alpineSpring',
      'alpine-glacial': 'glacialMelt',
      'glacial-melt': 'glacialMelt',
      glacial: 'glacialMelt',
      'canyon-sunset': 'slotCanyon',
      slot: 'slotCanyon',
      'slot-canyon': 'slotCanyon',
      'midnight-mist': 'midnightMist',
    };

    expect(Object.keys(LEGACY_BIOME_ALIASES).sort()).toEqual(
      Object.keys(expected).sort(),
    );

    for (const [alias, canonical] of Object.entries(expected)) {
      expect(normalizeBiomeId(alias)).toBe(canonical);
      expect(LEGACY_BIOME_ALIASES[alias]).toBe(canonical);
    }
  });

  it('returns each canonical BiomeId unchanged (identity)', () => {
    for (const id of BIOME_IDS) {
      expect(normalizeBiomeId(id)).toBe(id);
      expect(isBiomeId(id)).toBe(true);
    }
  });

  it('keeps glacier distinct from glacialMelt', () => {
    expect(normalizeBiomeId('glacier')).toBe('glacier');
    expect(normalizeBiomeId('glacier')).not.toBe('glacialMelt');
  });

  it('maps canyon-sunset to slotCanyon and midnight-mist to midnightMist', () => {
    expect(normalizeBiomeId('canyon-sunset')).toBe('slotCanyon');
    expect(normalizeBiomeId('midnight-mist')).toBe('midnightMist');
  });

  it('falls back to canyonSummer for unknown ids', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeBiomeId('not-a-biome')).toBe(DEFAULT_BIOME_ID);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('track + palette lookup for canonical ids', () => {
  it('resolves a track profile and palette for every BiomeId', () => {
    for (const id of BIOME_IDS) {
      const profile = getTrackBiomeProfile(id);
      const palette = getBiomePalette(id);
      expect(profile.id).toBe(id);
      expect(palette.id).toBe(id);
    }
  });
});

describe('legacy map-load fixture', () => {
  it('loads kebab biomeOverride strings as canonical BiomeIds', () => {
    const levelData = {
      metadata: {
        name: 'Legacy Alias Fixture',
        author: 'test',
        difficulty: 'beginner',
        estimatedDuration: 1,
        version: '1.0.0',
      },
      world: {
        track: {
          waypoints: [
            [0, 0, 0],
            [0, 0, -50],
            [0, 0, -100],
            [0, 0, -150],
          ],
          segmentLength: 50,
          totalSegments: 3,
          width: 35,
        },
        biome: {
          baseType: 'creek-summer',
          sky: { color: '#87CEEB' },
          fog: { color: '#D4E9F7', near: 40, far: 200 },
          lighting: { sunIntensity: 1, sunAngle: 45, ambientIntensity: 0.4 },
          water: { color: '#1a7b9c', opacity: 0.85, flowSpeed: 1 },
        },
      },
      segments: [
        { index: 0, biomeOverride: 'creek-summer' },
        { index: 1, biomeOverride: 'canyon-sunset' },
        { index: 2, biomeOverride: 'midnight-mist' },
      ],
    } as unknown as LevelData;

    const manager = new JSONMapManager(levelData);
    expect(manager.getChunkConfig(0).biome).toBe('canyonSummer');
    expect(manager.getChunkConfig(1).biome).toBe('slotCanyon');
    expect(manager.getChunkConfig(2).biome).toBe('midnightMist');
  });
});
