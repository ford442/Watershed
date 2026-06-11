import * as THREE from 'three';
import { FLOW_FORECAST_STATES, type FlowForecastState } from '../constants/game';

export type TrackBiomeId = 'summer' | 'autumn' | 'slotCanyon' | 'delta' | 'glacier';

export type TreeSpeciesId = 'conifer' | 'broadleaf' | 'birch' | 'snag';

export type TreeSpeciesWeights = Record<TreeSpeciesId, number>;

export type TrackBiomeProfile = {
  id: TrackBiomeId;
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

export const TRACK_BIOMES: Record<TrackBiomeId, TrackBiomeProfile> = {
  summer: {
    id: 'summer',
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
  },
  autumn: {
    id: 'autumn',
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
  },
  slotCanyon: {
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
  },
  glacier: {
    id: 'glacier',
    waterWidth: 7,
    canyonWidth: 28,
    // Glacier channels are high-walled ice chutes, narrower than summer canyon
    wallHeight: 20,
    wallTightness: 0.55,
    // Low friction = slippery ice walls; physics layer reads this for contact response
    wallFriction: 0.18,
    wallShadowStrength: 0.65,
    // Very sparse vegetation — only isolated dead conifers survive at altitude
    vegetationDensity: 0.12,
    rockDensity: 'medium' as const,
    // Blue-grey ice-scoured granite colours
    rockBaseColor: '#b0c8d8',
    rockShadowColor: '#3a5060',
    rockRimColor: '#e8f4ff',
    decorationBias: { trees: 0.1, grasses: 0.05, reeds: 0.0, rocks: 1.2 },
    treeSpeciesWeights: {
      // Mostly dead snags; a few spindly conifers clinging to rock ledges
      floor: { conifer: 0.25, broadleaf: 0.0, birch: 0.1, snag: 0.65 },
      rim:   { conifer: 0.35, broadleaf: 0.0, birch: 0.05, snag: 0.6 },
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
};

export function getTrackBiomeProfile(biome: string): TrackBiomeProfile {
  if (biome === 'slot' || biome === 'slot-canyon') {
    return TRACK_BIOMES.slotCanyon;
  }

  if (biome === 'autumn') {
    return TRACK_BIOMES.autumn;
  }

  if (biome === 'delta') {
    return TRACK_BIOMES.delta;
  }

  if (biome === 'glacier' || biome === 'glacial') {
    return TRACK_BIOMES.glacier;
  }

  return TRACK_BIOMES.summer;
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
