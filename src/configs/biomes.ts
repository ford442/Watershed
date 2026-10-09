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
    canonical === 'lumberFlume' ||
    // Delta finale reuses summer sandbar / marsh vegetation branching.
    canonical === 'delta'
  );
}

/**
 * Water surface look + flow per biome (#465 C1). Keyed by BiomeId so a new
 * biome cannot compile without one — the old `constants/biomes` table was keyed
 * river/canyon/flume/glacial and every canonical id but glacier/hydroDam fell
 * through to `river` silently.
 */
export interface WaterProfile {
  waterColor: string;
  foamColor: string;
  edgeHighlight: string;
  /** Scales FlowingWater's flowSpeed (visual surface flow). */
  flowMultiplier: number;
  /** Remote shader preset (useShaderLoader); builtin GLSL when unset or unreachable. */
  shaderId?: string;
}

const RIVER_WATER: WaterProfile = {
  waterColor: '#3b9c9c',
  foamColor: '#e0f4ff',
  edgeHighlight: '#5cb8a6',
  flowMultiplier: 1.0,
};

/** Milky blue-white glacial flour suspended in meltwater (glacier + glacialMelt). */
const GLACIAL_COLORS = {
  waterColor: '#a8d8ea',
  foamColor: '#e8f6ff',
  edgeHighlight: '#c8eeff',
} as const;

export const WATER_PROFILES: Readonly<Record<BiomeId, WaterProfile>> = {
  canyonSummer: RIVER_WATER,
  canyonAutumn: RIVER_WATER,
  delta: RIVER_WATER,
  alpineSpring: RIVER_WATER,
  cavern: RIVER_WATER,
  midnightMist: RIVER_WATER,
  slotCanyon: {
    waterColor: '#d97706',
    foamColor: '#f5d7a0',
    edgeHighlight: '#fbbf24',
    flowMultiplier: 1.4,
  },
  lumberFlume: {
    waterColor: '#854d0e',
    foamColor: '#f5e8c7',
    edgeHighlight: '#a16207',
    flowMultiplier: 1.8,
    shaderId: 'flume-turbulent-v1',
  },
  glacialMelt: { ...GLACIAL_COLORS, flowMultiplier: 1.2 },
  // Fast-moving meltwater — steeper gradient than glacialMelt.
  glacier: { ...GLACIAL_COLORS, flowMultiplier: 1.6 },
  hydroDam: {
    waterColor: '#2a4a5a',
    foamColor: '#c0d0d8',
    edgeHighlight: '#7a9aaa',
    flowMultiplier: 1.35,
  },
};

export function getWaterProfile(id: BiomeId | string): WaterProfile {
  return WATER_PROFILES[isBiomeId(id) ? id : normalizeBiomeId(id)];
}

/**
 * One label per biome a shipped map actually uses. Palette-only stubs
 * (PALETTE_ONLY_BIOMES) are deliberately absent; lumber/hydro were missing and
 * read as CANYON SUMMER on their own maps.
 */
export const BIOME_HUD_LABELS: Partial<Record<BiomeId, string>> = {
  canyonSummer: 'CANYON SUMMER',
  canyonAutumn: 'CANYON AUTUMN',
  delta: 'RIVER DELTA',
  slotCanyon: 'SLOT CANYON',
  glacier: 'GLACIER',
  glacialMelt: 'GLACIAL MELT',
  cavern: 'ICE CAVERN',
  lumberFlume: 'LUMBER FLUME',
  hydroDam: 'HYDRO DAM',
};
