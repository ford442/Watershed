/**
 * Palette-only stub biomes (alpineSpring / midnightMist / cavern) clone another
 * biome's walls. They must not be advertised until a map gives them their own.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PALETTE_ONLY_BIOMES, TRACK_BIOMES } from './TrackBiomes';
import { normalizeBiomeId } from './biomes';
import { BIOME_HUD_LABELS } from '../constants/biomes';
import { MAP_REGISTRY, mapRegistryIds } from '../maps/registry';
import { BiomeSelector } from '../components/LevelEditor/BiomeSelector';

function shippedBiomes(): Set<string> {
  const biomes = new Set<string>();
  for (const id of mapRegistryIds()) {
    for (const segment of MAP_REGISTRY[id].levelData.segments) {
      if (segment.biomeOverride) biomes.add(normalizeBiomeId(segment.biomeOverride));
    }
  }
  return biomes;
}

describe('palette-only biomes', () => {
  it('are geometry clones — same walls as a real biome', () => {
    const withoutId = (profile: object) => JSON.stringify({ ...profile, id: undefined });
    for (const id of PALETTE_ONLY_BIOMES) {
      const twin = Object.values(TRACK_BIOMES).find(
        (other) => !PALETTE_ONLY_BIOMES.has(other.id) && withoutId(other) === withoutId(TRACK_BIOMES[id]),
      );
      expect(twin, `${id} is a clone`).toBeDefined();
    }
  });

  it('are not used by any shipped map (give one real walls before a map does)', () => {
    const used = shippedBiomes();
    for (const id of PALETTE_ONLY_BIOMES) expect(used.has(id), id).toBe(false);
  });

  it('have no HUD label, while every shipped biome has one', () => {
    for (const id of PALETTE_ONLY_BIOMES) expect(BIOME_HUD_LABELS[id]).toBeUndefined();
    for (const id of shippedBiomes()) expect(BIOME_HUD_LABELS[id], id).toBeDefined();
  });

  it('are not offered by the Level Editor biome selector', () => {
    render(<BiomeSelector selectedBiome="canyonSummer" onSelect={() => {}} />);
    expect(screen.queryByText('Alpine Spring')).toBeNull();
    expect(screen.queryByText('Midnight Mist')).toBeNull();
    expect(screen.getAllByText('Canyon Summer').length).toBeGreaterThan(0);
  });
});
