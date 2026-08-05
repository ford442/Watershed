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
  hydro: {
    checkpoints: [
      {
        segment: 4,
        label: 'Stilling basin',
        position: [0, -4, -190],
        radius: 35,
      },
      {
        segment: 8,
        label: 'Outfall splash',
        position: [0, -16, -480],
        radius: 30,
      },
    ],
    portageRoutes: [
      {
        segmentIndex: 13,
        label: 'Portage ledge above the catwalk gate',
      },
    ],
  },
  delta: {
    checkpoints: [
      {
        segment: 2,
        label: 'Raft launch',
        position: [0, -3, -90],
        radius: 40,
      },
      {
        segment: 6,
        label: 'Open water',
        position: [0, -5, -280],
        radius: 45,
      },
      {
        segment: 14,
        label: 'Channels rejoin',
        position: [0, -6, -620],
        radius: 40,
      },
      {
        segment: 21,
        label: 'Beach landing',
        position: [0, -6, -920],
        radius: 50,
      },
    ],
    maxCachePlacements: 1,
    cacheSlots: [
      {
        id: 'delta-sandbar-8',
        segmentIndex: 8,
        label: 'Sandbar cache above the braid',
        retrievalBonus: 300,
      },
    ],
    portageRoutes: [
      {
        segmentIndex: 11,
        label: 'Side washout past the forecast fork',
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
