/**
 * BiomePalettes facade — re-exports the split palette modules under
 * `configs/palettes/` so existing `from '../configs/BiomePalettes'` imports
 * keep working without changes.
 */

export type { BiomeId } from './biomes';
export {
  BIOME_IDS,
  DEFAULT_BIOME_ID,
  LEGACY_BIOME_ALIASES,
  isAutumnLike,
  isBiomeId,
  isSummerLike,
  normalizeBiomeId,
} from './biomes';

export type { BiomePalette, BiomeLightingOptions } from './palettes';
export {
  BiomePalettes,
  getBiomePalette,
  lerpBiomePalettes,
  applyBiomeToLighting,
} from './palettes';

export { default } from './palettes';
