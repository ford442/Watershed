/**
 * runSession.ts — Per-run session state (launch hour, cache placements).
 *
 * Not written to Zustand each frame; initialized at run start from persistence +
 * StartMenu choices, then read by forecast / scoring systems.
 */

import type { MapRegistryId } from '../maps/registry';
import { getMapSurvivalMetadata } from '../maps/survivalMetadata';
import {
  createPortageCacheRunState,
  placeCache,
  reducePortageCacheState,
  type PortageCacheEvent,
  type PortageCacheRunState,
  DEFAULT_MAX_CACHE_PLACEMENTS,
} from './portageCache';
import { getLaunchHour } from './PersistenceSystem';

export interface RunSessionSnapshot {
  mapId: MapRegistryId;
  launchHour: number;
  placedCacheIds: string[];
  portageCache: PortageCacheRunState;
}

let activeSession: RunSessionSnapshot | null = null;
let awardedCacheSegments = new Set<number>();

export function initRunSession(options: {
  mapId: MapRegistryId;
  launchHour?: number;
  placedCacheIds?: string[];
}): RunSessionSnapshot {
  const survival = getMapSurvivalMetadata(options.mapId);
  const launchHour = normalizeHour(options.launchHour ?? getLaunchHour());
  const maxPlacements = survival.maxCachePlacements ?? DEFAULT_MAX_CACHE_PLACEMENTS;

  let portageCache = createPortageCacheRunState({
    cacheSlots: survival.cacheSlots,
    portageRoutes: survival.portageRoutes,
  });

  const placedCacheIds: string[] = [];
  for (const slotId of options.placedCacheIds ?? []) {
    if (portageCache.cacheSlots.some((slot) => slot.id === slotId && slot.status === 'unplaced')) {
      portageCache = placeCache(portageCache, slotId, maxPlacements);
      if (portageCache.cacheSlots.find((slot) => slot.id === slotId)?.status === 'placed') {
        placedCacheIds.push(slotId);
      }
    }
  }

  activeSession = {
    mapId: options.mapId,
    launchHour,
    placedCacheIds,
    portageCache,
  };
  awardedCacheSegments = new Set();
  return activeSession;
}

export function getRunSession(): RunSessionSnapshot | null {
  return activeSession;
}

export function getActiveLaunchHour(): number {
  return activeSession?.launchHour ?? getLaunchHour();
}

export function dispatchPortageCacheEvent(event: PortageCacheEvent): PortageCacheRunState | null {
  if (!activeSession) return null;
  activeSession = {
    ...activeSession,
    portageCache: reducePortageCacheState(activeSession.portageCache, event),
  };
  return activeSession.portageCache;
}

export function markCacheBonusAwarded(segmentIndex: number): boolean {
  if (awardedCacheSegments.has(segmentIndex)) return false;
  awardedCacheSegments.add(segmentIndex);
  return true;
}

export function resetRunSessionForTests(): void {
  activeSession = null;
  awardedCacheSegments = new Set();
}

function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  const wrapped = Math.floor(hour) % 24;
  return wrapped < 0 ? wrapped + 24 : wrapped;
}
