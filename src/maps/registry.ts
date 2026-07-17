/**
 * Map registry — single switch point for authored map content.
 *
 * Change `ACTIVE_MAP_ID` to load a different map without editing TrackManager
 * or Experience wiring.
 */

import type { LevelData, SegmentRange } from '../systems/MapSystem';
import glacialLevel from './glacial_source.json';
import meanderLevel from './meander_to_waterfall.json';
import deltaLevel from './delta_rapids.json';
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

export interface MapContinuation {
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
  initialBiome: string;
  /** Optional second authored map chained after primary segments are exhausted. */
  continuation?: MapContinuation;
}

export const MAP_REGISTRY = {
  glacial: {
    id: 'glacial',
    label: 'Map 0: Glacial Source',
    levelData: glacialLevel as unknown as LevelData,
    fallbackProgression: GLACIAL_SOURCE_FALLBACK_PROGRESSION,
    startIndex: GLACIAL_SOURCE_START_INDEX,
    initialBiome: 'glacialMelt',
    continuation: {
      levelData: meanderLevel as unknown as LevelData,
      startIndex: 0,
    },
  },
  meander: {
    id: 'meander',
    label: 'Map 1: Meander to Waterfall',
    levelData: meanderLevel as unknown as LevelData,
    fallbackProgression: MEANDER_FALLBACK_PROGRESSION,
    startIndex: GLACIER_START_INDEX,
    initialBiome: 'canyonSummer',
  },
  delta: {
    id: 'delta',
    label: 'Map 2: Delta Rapids Stub',
    levelData: deltaLevel as unknown as LevelData,
    fallbackProgression: DELTA_RAPIDS_CONTINUED_PROGRESSION,
    startIndex: DELTA_RAPIDS_CONTINUED_START_INDEX,
    initialBiome: 'delta',
  },
} satisfies Record<string, MapDefinition>;

export type MapRegistryId = keyof typeof MAP_REGISTRY;

/** Change this constant to load a different authored map. */
export const ACTIVE_MAP_ID: MapRegistryId = 'meander';

export function getMapDefinition(mapId: MapRegistryId = ACTIVE_MAP_ID): MapDefinition {
  return MAP_REGISTRY[mapId];
}

export function getActiveMap(): MapDefinition {
  return getMapDefinition(ACTIVE_MAP_ID);
}
