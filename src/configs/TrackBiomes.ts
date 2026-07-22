import * as THREE from 'three';
import { FLOW_FORECAST_STATES, type FlowForecastState } from '../constants/game';
import {
  type BiomeId,
  DEFAULT_BIOME_ID,
  isBiomeId,
  normalizeBiomeId,
} from './biomes';

export type { BiomeId } from './biomes';
export { isAutumnLike, isSummerLike, normalizeBiomeId } from './biomes';

/** @deprecated Use BiomeId — kept as alias during migration. */
export type TrackBiomeId = BiomeId;

export type TreeSpeciesId = 'conifer' | 'broadleaf' | 'birch' | 'snag';

export type TreeSpeciesWeights = Record<TreeSpeciesId, number>;

export type TrackBiomeProfile = {
  id: BiomeId;
  waterWidth: number;
  canyonWidth: number;
  wallHeight: number;
  wallTightness: number;
  wallFriction: number;
  wallShadowStrength: number;
  vegetationDensity: number;
  rockDensity: 'low' | 'medium' | 'high';
  rockBaseColor: string;
  rockShadowColor: string;
  rockRimColor: string;
  decorationBias: {
    trees: number;
    grasses: number;
    reeds: number;
    rocks: number;
  };
  treeSpeciesWeights: {
    floor: TreeSpeciesWeights;
    rim: TreeSpeciesWeights;
  };
};

const canyonSummerProfile: TrackBiomeProfile = {
  id: 'canyonSummer',
  waterWidth: 10,
  canyonWidth: 35,
  wallHeight: 18,
  wallTightness: 0.45,
  wallFriction: 1,
  wallShadowStrength: 0.5,
  vegetationDensity: 1,
  rockDensity: 'low',
  rockBaseColor: '#9a8e78',
  rockShadowColor: '#3e5038',
  rockRimColor: '#d0d8c8',
  decorationBias: { trees: 1, grasses: 1, reeds: 1, rocks: 0.8 },
  treeSpeciesWeights: {
    floor: { conifer: 0.45, broadleaf: 0.15, birch: 0.35, snag: 0.05 },
    rim: { conifer: 0.55, broadleaf: 0.05, birch: 0.2, snag: 0.2 },
  },
};

const canyonAutumnProfile: TrackBiomeProfile = {
  id: 'canyonAutumn',
  waterWidth: 12,
  canyonWidth: 40,
  wallHeight: 19,
  wallTightness: 0.5,
  wallFriction: 1.05,
  wallShadowStrength: 0.55,
  vegetationDensity: 0.85,
  rockDensity: 'high',
  rockBaseColor: '#8b7355',
  rockShadowColor: '#584028',
  rockRimColor: '#d8c898',
  decorationBias: { trees: 0.85, grasses: 0.8, reeds: 0.9, rocks: 1.2 },
  treeSpeciesWeights: {
    floor: { conifer: 0.15, broadleaf: 0.55, birch: 0.1, snag: 0.2 },
    rim: { conifer: 0.25, broadleaf: 0.15, birch: 0.05, snag: 0.55 },
  },
};

const slotCanyonProfile: TrackBiomeProfile = {
  id: 'slotCanyon',
  waterWidth: 8,
  canyonWidth: 24,
  wallHeight: 26,
  wallTightness: 0.78,
  wallFriction: 1.45,
  wallShadowStrength: 0.95,
  vegetationDensity: 0.15,
  rockDensity: 'high',
  rockBaseColor: '#a65f3a',
  rockShadowColor: '#4d2315',
  rockRimColor: '#f0a86d',
  decorationBias: { trees: 0.1, grasses: 0.15, reeds: 0.15, rocks: 1.5 },
  treeSpeciesWeights: {
    floor: { conifer: 0.15, broadleaf: 0.05, birch: 0.05, snag: 0.75 },
    rim: { conifer: 0.2, broadleaf: 0.05, birch: 0.05, snag: 0.7 },
  },
};

export const TRACK_BIOMES: Record<BiomeId, TrackBiomeProfile> = {
  canyonSummer: canyonSummerProfile,
  canyonAutumn: canyonAutumnProfile,
  slotCanyon: slotCanyonProfile,
  glacialMelt: {
    id: 'glacialMelt',
    waterWidth: 6,
    canyonWidth: 25,
    wallHeight: 22,
    wallTightness: 0.72,
    wallFriction: 0.14,
    wallShadowStrength: 0.75,
    vegetationDensity: 0.05,
    rockDensity: 'medium',
    rockBaseColor: '#c8d8e8',
    rockShadowColor: '#2a4858',
    rockRimColor: '#f0f8ff',
    decorationBias: { trees: 0.04, grasses: 0.02, reeds: 0.0, rocks: 1.4 },
    treeSpeciesWeights: {
      floor: { conifer: 0.15, broadleaf: 0.0, birch: 0.05, snag: 0.8 },
      rim: { conifer: 0.2, broadleaf: 0.0, birch: 0.05, snag: 0.75 },
    },
  },
  glacier: {
    id: 'glacier',
    waterWidth: 7,
    canyonWidth: 28,
    wallHeight: 20,
    wallTightness: 0.55,
    wallFriction: 0.18,
    wallShadowStrength: 0.65,
    vegetationDensity: 0.12,
    rockDensity: 'medium',
    rockBaseColor: '#b0c8d8',
    rockShadowColor: '#3a5060',
    rockRimColor: '#e8f4ff',
    decorationBias: { trees: 0.1, grasses: 0.05, reeds: 0.0, rocks: 1.2 },
    treeSpeciesWeights: {
      floor: { conifer: 0.25, broadleaf: 0.0, birch: 0.1, snag: 0.65 },
      rim: { conifer: 0.35, broadleaf: 0.0, birch: 0.05, snag: 0.6 },
    },
  },
  delta: {
    id: 'delta',
    waterWidth: 35,
    canyonWidth: 100,
    wallHeight: 8,
    wallTightness: 0.2,
    wallFriction: 0.6,
    wallShadowStrength: 0.2,
    vegetationDensity: 0.5,
    rockDensity: 'low',
    rockBaseColor: '#9a9a78',
    rockShadowColor: '#5a6a48',
    rockRimColor: '#d0d8c0',
    decorationBias: { trees: 0.4, grasses: 1.2, reeds: 1.5, rocks: 0.2 },
    treeSpeciesWeights: {
      floor: { conifer: 0.05, broadleaf: 0.6, birch: 0.1, snag: 0.25 },
      rim: { conifer: 0.05, broadleaf: 0.5, birch: 0.1, snag: 0.35 },
    },
  },
  // Palette-only / stub profiles (geometry clones until dedicated content lands)
  alpineSpring: { ...canyonSummerProfile, id: 'alpineSpring' },
  midnightMist: { ...canyonAutumnProfile, id: 'midnightMist' },
  cavern: { ...slotCanyonProfile, id: 'cavern' },
  lumberFlume: {
    id: 'lumberFlume',
    waterWidth: 8,
    canyonWidth: 28,
    // Lower walls than summer canyon — elevated wooden aqueduct read
    wallHeight: 12,
    wallTightness: 0.62,
    wallFriction: 0.42,
    wallShadowStrength: 0.7,
    vegetationDensity: 1.35,
    rockDensity: 'medium',
    // Damp mossy timber / wet bark tones
    rockBaseColor: '#5a4a38',
    rockShadowColor: '#2a3a28',
    rockRimColor: '#8a9a70',
    decorationBias: { trees: 1.4, grasses: 0.9, reeds: 0.7, rocks: 0.6 },
    treeSpeciesWeights: {
      floor: { conifer: 0.55, broadleaf: 0.25, birch: 0.1, snag: 0.1 },
      rim: { conifer: 0.65, broadleaf: 0.15, birch: 0.05, snag: 0.15 },
    },
  },
  hydroDam: { ...slotCanyonProfile, id: 'hydroDam' },
};

export function isGlacialBiome(biome: string, profile?: TrackBiomeProfile): boolean {
  const id = profile?.id ?? (isBiomeId(biome) ? biome : normalizeBiomeId(biome));
  return id === 'glacialMelt' || id === 'glacier';
}

/**
 * Resolve a track profile. Prefer passing a canonical BiomeId.
 * Raw legacy strings are normalized for convenience at load boundaries.
 */
export function getTrackBiomeProfile(biome: string): TrackBiomeProfile {
  const id = isBiomeId(biome) ? biome : normalizeBiomeId(biome);
  return TRACK_BIOMES[id] ?? TRACK_BIOMES[DEFAULT_BIOME_ID];
}

export function getForecastedBiomeState(flowRate: number): FlowForecastState {
  if (flowRate >= 1.35) return FLOW_FORECAST_STATES.FLOODED;
  if (flowRate >= 1.05) return FLOW_FORECAST_STATES.HIGH_FLOW;
  return FLOW_FORECAST_STATES.NORMAL;
}

export function lerpTrackBiomeColor(from: string, to: string, alpha: number): string {
  const color = new THREE.Color(from);
  color.lerp(new THREE.Color(to), alpha);
  return `#${color.getHexString()}`;
}
