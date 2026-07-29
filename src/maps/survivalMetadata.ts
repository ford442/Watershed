/**
 * survivalMetadata.ts — Portage routes and cache slots per map.
 */

import type { MapRegistryId } from './registry';
import type { CacheSlotDefinition, PortageRouteDefinition } from '../systems/portageCache';
import type { CheckpointDefinition } from '../systems/survival';

export interface MapSurvivalMetadata {
  maxCachePlacements?: number;
  cacheSlots?: CacheSlotDefinition[];
  portageRoutes?: PortageRouteDefinition[];
  /** Authored respawn anchors — latest segment at or behind player wins. */
  checkpoints?: CheckpointDefinition[];
}

const SURVIVAL_BY_MAP: Partial<Record<MapRegistryId, MapSurvivalMetadata>> = {
  meander: {
    checkpoints: [
      {
        segment: 13,
        label: 'Approach shelf',
        position: [0, -20, -300],
        radius: 30,
      },
      {
        segment: 15,
        label: 'Splash pool',
        position: [0, -35, -700],
        radius: 40,
      },
    ],
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
  return Boolean(
    meta.cacheSlots?.length ||
      meta.portageRoutes?.length ||
      meta.checkpoints?.length,
  );
}
