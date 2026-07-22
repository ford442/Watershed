/**
 * Canonical biome IDs — single vocabulary for track geometry, palettes, HUD, and maps.
 *
 * Legacy / kebab aliases are resolved only at map-load boundaries via normalizeBiomeId.
 * Runtime systems (ChunkManager, TrackSegment, BiomeSystem) should pass BiomeId only.
 */

export type BiomeId =
  | 'canyonSummer'
  | 'canyonAutumn'
  | 'slotCanyon'
  | 'glacialMelt'
  | 'glacier'
  | 'delta'
  | 'alpineSpring'
  | 'cavern'
  | 'midnightMist'
  | 'lumberFlume'
  | 'hydroDam';

/** All canonical IDs — used by isBiomeId and identity tests. */
export const BIOME_IDS: readonly BiomeId[] = [
  'canyonSummer',
  'canyonAutumn',
  'slotCanyon',
  'glacialMelt',
  'glacier',
  'delta',
  'alpineSpring',
  'cavern',
  'midnightMist',
  'lumberFlume',
  'hydroDam',
] as const;

const BIOME_ID_SET = new Set<string>(BIOME_IDS);

/**
 * Deprecated aliases accepted only when loading authored map/reach JSON.
 * Do not call from hot paths — normalize once at the load boundary.
 */
export const LEGACY_BIOME_ALIASES: Record<string, BiomeId> = {
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

export const DEFAULT_BIOME_ID: BiomeId = 'canyonSummer';

export function isBiomeId(s: string): s is BiomeId {
  return BIOME_ID_SET.has(s);
}

/**
 * Map-load adapter: resolve legacy/kebab strings to canonical BiomeId.
 * Unknown values fall back to canyonSummer with a console warning.
 */
export function normalizeBiomeId(raw: string): BiomeId {
  if (isBiomeId(raw)) return raw;
  const aliased = LEGACY_BIOME_ALIASES[raw];
  if (aliased) return aliased;
  console.warn(`[biome] Unknown biome id "${raw}"; falling back to ${DEFAULT_BIOME_ID}`);
  return DEFAULT_BIOME_ID;
}

/** Autumn-like biomes for decoration / material branching. */
export function isAutumnLike(id: BiomeId | string): boolean {
  const canonical = isBiomeId(id) ? id : normalizeBiomeId(id);
  return canonical === 'canyonAutumn' || canonical === 'midnightMist';
}

/** Summer-like biomes for decoration branching (sand bars, greener vegetation). */
export function isSummerLike(id: BiomeId | string): boolean {
  const canonical = isBiomeId(id) ? id : normalizeBiomeId(id);
  return (
    canonical === 'canyonSummer' ||
    canonical === 'alpineSpring' ||
    canonical === 'lumberFlume'
  );
}
