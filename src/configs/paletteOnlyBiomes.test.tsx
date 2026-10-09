/**
 * Palette-only stub biomes (alpineSpring / midnightMist) clone another biome's
 * walls. They must not be advertised until a map gives them their own — as
 * `cavern` did (#464): its own profile, its own vault, on the glacial source.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PALETTE_ONLY_BIOMES, TRACK_BIOMES } from './TrackBiomes';
import { BIOME_HUD_LABELS, LEGACY_BIOME_ALIASES, normalizeBiomeId } from './biomes';
import { MAP_REGISTRY, mapRegistryIds } from '../maps/registry';
import { BiomeSelector } from '../components/LevelEditor/BiomeSelector';
import levelSchema from '../formats/level.schema.json';
import reachSchema from '../formats/reach.schema.json';

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

  it('cavern earned its name: a distinct profile, on a shipped map, with a HUD label (#464)', () => {
    expect(PALETTE_ONLY_BIOMES.has('cavern')).toBe(false);
    const withoutId = (profile: object) => JSON.stringify({ ...profile, id: undefined });
    const twins = Object.values(TRACK_BIOMES).filter(
      (other) => other.id !== 'cavern' && withoutId(other) === withoutId(TRACK_BIOMES.cavern),
    );
    expect(twins.map((twin) => twin.id)).toEqual([]);
    expect(shippedBiomes().has('cavern')).toBe(true);
    expect(BIOME_HUD_LABELS.cavern).toBe('ICE CAVERN');
    for (const schema of [levelSchema, reachSchema] as const) {
      expect(schema.properties.segments.items.properties.biomeOverride.enum).toContain('cavern');
    }
  });

  it('are not legal in level / reach schema biome enums (#438 E3)', () => {
    const stubTokens = new Set<string>(PALETTE_ONLY_BIOMES);
    for (const [alias, id] of Object.entries(LEGACY_BIOME_ALIASES)) {
      if (PALETTE_ONLY_BIOMES.has(id)) stubTokens.add(alias);
    }
    for (const schema of [levelSchema, reachSchema] as const) {
      const enums = [
        schema.properties.world.properties.biome.properties.baseType.enum,
        schema.properties.segments.items.properties.biomeOverride.enum,
      ];
      for (const values of enums) {
        expect(values).toContain('canyonSummer');
        for (const token of stubTokens) expect(values, token).not.toContain(token);
      }
    }
  });
});
