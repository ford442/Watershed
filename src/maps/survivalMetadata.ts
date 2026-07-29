/**
 * survivalMetadata.ts — Portage routes and cache slots per map.
 */

import type { MapRegistryId } from './registry';
import type { CacheSlotDefinition, PortageRouteDefinition } from '../systems/portageCache';

export interface MapSurvivalMetadata {
  maxCachePlacements?: number;
  cacheSlots?: CacheSlotDefinition[];
  portageRoutes?: PortageRouteDefinition[];
}

const SURVIVAL_BY_MAP: Partial<Record<MapRegistryId, MapSurvivalMetadata>> = {
  meander: {
    maxCachePlacements: 1,
    cacheSlots: [
      {
        id: 'meander-ridge-10',
        segmentIndex: 10,
        label: 'Rim shelf above the trestle',
        retrievalBonus: 250,
      },
    ],
    portageRoutes: [
      {
        segmentIndex: 11,
        label: 'High-line portage past the trestle',
      },
    ],
  },
};

export function getMapSurvivalMetadata(mapId: MapRegistryId): MapSurvivalMetadata {
  return SURVIVAL_BY_MAP[mapId] ?? {};
}

export function mapHasSurvivalFeatures(mapId: MapRegistryId): boolean {
  const meta = getMapSurvivalMetadata(mapId);
  return Boolean(meta.cacheSlots?.length || meta.portageRoutes?.length);
}
