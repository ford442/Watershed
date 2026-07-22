/**
 * Map registry — single switch point for authored map content.
 *
 * Runtime map selection prefers URL `?map=` / StartMenu via `resolveMapId`
 * in `campaign.ts`. `ACTIVE_MAP_ID` remains the code-level fallback default.
 */

import type { LevelData, SegmentRange } from '../systems/MapSystem';
import type { BiomeId } from '../configs/biomes';
import glacialLevel from './glacial_source.json';
import meanderLevel from './meander_to_waterfall.json';
import deltaLevel from './delta_rapids.json';
import lumberLevel from './lumber_flume.json';
import {
  DELTA_RAPIDS_CONTINUED_START_INDEX,
  GLACIER_START_INDEX,
  MEANDER_FALLBACK_PROGRESSION,
  DELTA_RAPIDS_CONTINUED_PROGRESSION,
} from './meander_to_waterfall';
import {
  GLACIAL_SOURCE_START_INDEX,
  GLACIAL_SOURCE_FALLBACK_PROGRESSION,
} from './glacial_source';
import {
  LUMBER_FLUME_START_INDEX,
  LUMBER_FLUME_FALLBACK_PROGRESSION,
} from './lumber_flume';

/** Stable registry keys — declared early so MapDefinition can reference them. */
export type MapRegistryId = 'glacial' | 'lumber' | 'meander' | 'delta';

export interface MapContinuation {
  /** Campaign target map when this map's journey completes (or for UI labels). */
  mapId?: MapRegistryId;
  levelData: LevelData;
  /** Segment index in the continuation map to use when the primary map is exhausted. */
  startIndex?: number;
}

export interface MapDefinition {
  id: string;
  label: string;
  levelData: LevelData;
  fallbackProgression: SegmentRange[];
  startIndex: number;
  initialBiome: BiomeId;
  /** Authored difficulty label for StartMenu. */
  difficulty?: string;
  /** Estimated run length in seconds (StartMenu). */
  estimatedDurationSec?: number;
  /**
   * Soft-lock prerequisite — map is marked locked until this id is in
   * `completedMaps`. Selection remains allowed (AC: pick any registered map).
   */
  unlockAfter?: MapRegistryId;
  /**
   * Explicit campaign next map after `journeyComplete`.
   * Falls back to `continuation.mapId` when omitted.
   */
  nextMapId?: MapRegistryId;
  /** Optional second authored map chained after primary segments are exhausted. */
  continuation?: MapContinuation;
  /**
   * When true, the map is reachable via `?map=` deep link but omitted from the
   * StartMenu campaign list (e.g. interstitial "Map 0.5" experiments outside the
   * glacial → meander → delta chain).
   */
  menuHidden?: boolean;
}

export const MAP_REGISTRY: Record<MapRegistryId, MapDefinition> = {
  glacial: {
    id: 'glacial',
    label: 'Glacial Source',
    // intentional: JSON module has no LevelData schema at import
    levelData: glacialLevel as unknown as LevelData,
    fallbackProgression: GLACIAL_SOURCE_FALLBACK_PROGRESSION,
    startIndex: GLACIAL_SOURCE_START_INDEX,
    initialBiome: 'glacialMelt',
    difficulty: 'intermediate',
    estimatedDurationSec: 240,
    continuation: {
      mapId: 'meander',
      // intentional: JSON module has no LevelData schema at import
      levelData: meanderLevel as unknown as LevelData,
      startIndex: 0,
    },
  },
  lumber: {
    id: 'lumber',
    label: 'Map 0.5: Lumber Flume',
    // intentional: JSON module has no LevelData schema at import
    levelData: lumberLevel as unknown as LevelData,
    fallbackProgression: LUMBER_FLUME_FALLBACK_PROGRESSION,
    startIndex: LUMBER_FLUME_START_INDEX,
    initialBiome: 'lumberFlume',
    menuHidden: true,
    continuation: {
      // intentional: JSON module has no LevelData schema at import
      levelData: meanderLevel as unknown as LevelData,
      startIndex: 0,
    },
  },
  meander: {
    id: 'meander',
    label: 'Meander to Waterfall',
    // intentional: JSON module has no LevelData schema at import
    levelData: meanderLevel as unknown as LevelData,
    fallbackProgression: MEANDER_FALLBACK_PROGRESSION,
    startIndex: GLACIER_START_INDEX,
    initialBiome: 'canyonSummer',
    difficulty: 'beginner',
    estimatedDurationSec: 480,
    unlockAfter: 'glacial',
    nextMapId: 'delta',
  },
  delta: {
    id: 'delta',
    label: 'Delta Rapids',
    // intentional: JSON module has no LevelData schema at import
    levelData: deltaLevel as unknown as LevelData,
    fallbackProgression: DELTA_RAPIDS_CONTINUED_PROGRESSION,
    startIndex: DELTA_RAPIDS_CONTINUED_START_INDEX,
    initialBiome: 'delta',
    difficulty: 'beginner',
    estimatedDurationSec: 180,
    unlockAfter: 'meander',
  },
};

/** Code-level fallback when URL / menu / last-played are absent. */
export const ACTIVE_MAP_ID: MapRegistryId = 'meander';

/**
 * Stable registry id list in object-key order.
 * intentional: Object.keys loses keyof — single cast at the registry boundary.
 */
export function mapRegistryIds(): MapRegistryId[] {
  return Object.keys(MAP_REGISTRY) as Array<keyof typeof MAP_REGISTRY>;
}

/** True when `value` is a key of MAP_REGISTRY. */
export function isMapRegistryId(value: string | null | undefined): value is MapRegistryId {
  return typeof value === 'string' && value in MAP_REGISTRY;
}

export function getMapDefinition(mapId: MapRegistryId = ACTIVE_MAP_ID): MapDefinition {
  return MAP_REGISTRY[mapId];
}

export function getActiveMap(): MapDefinition {
  return getMapDefinition(ACTIVE_MAP_ID);
}

/** Resolve `?map=` URL tokens (and registry ids) to a MapRegistryId. */
export function resolveMapRegistryId(raw: string | null | undefined): MapRegistryId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key === 'lumber' || key === 'lumberflume' || key === 'flume') return 'lumber';
  if (key === 'glacial' || key === 'glacier') return 'glacial';
  if (key === 'delta') return 'delta';
  if (key === 'meander') return 'meander';
  if (isMapRegistryId(key)) return key;
  return null;
}
