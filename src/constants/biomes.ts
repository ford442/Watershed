// src/constants/biomes.ts
// Biome definitions for Watershed

export interface BiomeConfig {
  name: string;
  waterSpeed: number;
  waterColor: string;
  deepColor: string;
  foamColor: string;
  edgeHighlight: string;
  /** Prop types that spawn in this biome */
  props: string[];
  /** Chance (0-1) of vortex segment */
  vortexChance: number;
  /** Ambient music track ID */
  musicId: string;
  /** Shader preset (optional override) */
  shaderId?: string;
  /** Flow field multiplier for physics */
  flowMultiplier: number;
}

export const BIOMES: Record<string, BiomeConfig> = {
  river: {
    name: 'River',
    waterSpeed: 1.2,
    waterColor: '#3b9c9c',
    deepColor: '#1e4d5c',
    foamColor: '#e0f4ff',
    edgeHighlight: '#5cb8a6',
    props: ['reeds', 'pebbles', 'ferns', 'rocks'],
    vortexChance: 0.08,
    musicId: 'ambient-river-001',
    flowMultiplier: 1.0,
  },
  
  canyon: {
    name: 'Slot Canyon',
    waterSpeed: 2.1,
    waterColor: '#d97706',
    deepColor: '#92400e',
    foamColor: '#f5d7a0',
    edgeHighlight: '#fbbf24',
    props: ['rocks', 'boulders', 'pebbles'],
    vortexChance: 0.18,
    musicId: 'ambient-canyon-001',
    flowMultiplier: 1.4,
  },
  
  flume: {
    name: 'Lumber Flume',
    waterSpeed: 3.4,
    waterColor: '#854d0e',
    deepColor: '#451a03',
    foamColor: '#f5e8c7',
    edgeHighlight: '#a16207',
    props: ['wood_debris', 'planks', 'logs', 'barrels'],
    vortexChance: 0.12,
    musicId: 'ambient-flume-001',
    flowMultiplier: 1.8,
    shaderId: 'flume-turbulent-v1',
  },
  
  glacial: {
    name: 'Glacial Melt',
    waterSpeed: 1.8,
    waterColor: '#67e8f9',
    deepColor: '#0891b2',
    foamColor: '#cffafe',
    edgeHighlight: '#22d3ee',
    props: ['ice_chunks', 'snow_piles', 'crystals'],
    vortexChance: 0.05,
    musicId: 'ambient-glacial-001',
    flowMultiplier: 1.2,
  },
};

export type BiomeKey = keyof typeof BIOMES;

/** Get random biome key */
export const getRandomBiome = (): BiomeKey => {
  const keys = Object.keys(BIOMES) as BiomeKey[];
  return keys[Math.floor(Math.random() * keys.length)];
};

/** Get next biome with some continuity logic */
export const getNextBiome = (current: BiomeKey): BiomeKey => {
  const transitions: Record<BiomeKey, BiomeKey[]> = {
    river: ['canyon', 'flume', 'glacial'],
    canyon: ['river', 'flume'],
    flume: ['canyon', 'river'],
    glacial: ['river'],
  };
  
  const options = transitions[current] || Object.keys(BIOMES) as BiomeKey[];
  return options[Math.floor(Math.random() * options.length)];
};

export default BIOMES;
