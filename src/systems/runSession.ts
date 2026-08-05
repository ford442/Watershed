/**
 * runSession.ts — Per-run session state (launch hour, cache placements, survival).
 *
 * Not written to Zustand each frame; initialized at run start from persistence +
 * StartMenu choices, then read by forecast / scoring / physics systems.
 */

import type { MapRegistryId } from '../maps/registry';
import { getMapSurvivalMetadata } from '../maps/survivalMetadata';
import {
  createPortageCacheRunState,
  placeCache,
  reducePortageCacheState,
  totalCacheRetrievalBonus,
  type PortageCacheEvent,
  type PortageCacheRunState,
  DEFAULT_MAX_CACHE_PLACEMENTS,
} from './portageCache';
import { getLaunchHour } from './PersistenceSystem';
import {
  createSurvivalState,
  getLoadoutDefinition,
  getSurvivalModifiers,
  resolveLoadoutId,
  tickSurvivalState,
  type LoadoutId,
  type SurvivalModifiers,
  type SurvivalState,
  type SurvivalTickInput,
} from './survival';

export interface RunSessionSnapshot {
  mapId: MapRegistryId;
  launchHour: number;
  placedCacheIds: string[];
  loadoutId: LoadoutId;
  portageCache: PortageCacheRunState;
  survival: SurvivalState;
  /** Peak wetness observed during the run (0–1). */
  peakWetness: number;
  /** Meters traveled while raft was upright (tip danger not active). */
  uprightDistanceMeters: number;
}

let activeSession: RunSessionSnapshot | null = null;
let awardedCacheSegments = new Set<number>();

export function initRunSession(options: {
  mapId: MapRegistryId;
  launchHour?: number;
  placedCacheIds?: string[];
  loadoutId?: LoadoutId | string;
}): RunSessionSnapshot {
  const survival = getMapSurvivalMetadata(options.mapId);
  const launchHour = normalizeHour(options.launchHour ?? getLaunchHour());
  const maxPlacements = survival.maxCachePlacements ?? DEFAULT_MAX_CACHE_PLACEMENTS;
  const loadoutId = resolveLoadoutId(options.loadoutId);

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
    loadoutId,
    portageCache,
    survival: createSurvivalState(),
    peakWetness: 0,
    uprightDistanceMeters: 0,
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

export function getActiveLoadoutId(): LoadoutId {
  return activeSession?.loadoutId ?? resolveLoadoutId(undefined);
}

export function getActiveSurvivalState(): SurvivalState | null {
  return activeSession?.survival ?? null;
}

export function getActiveSurvivalModifiers(biomeId: SurvivalTickInput['biomeId']): SurvivalModifiers | null {
  if (!activeSession) return null;
  return getSurvivalModifiers(
    activeSession.survival,
    biomeId,
    getLoadoutDefinition(activeSession.loadoutId),
  );
}

export function tickRunSurvival(input: Omit<SurvivalTickInput, 'launchHour'>): SurvivalModifiers | null {
  if (!activeSession) return null;
  const loadout = getLoadoutDefinition(activeSession.loadoutId);
  const survival = tickSurvivalState(
    activeSession.survival,
    { ...input, launchHour: activeSession.launchHour },
    loadout,
  );
  activeSession = {
    ...activeSession,
    survival,
    peakWetness: Math.max(activeSession.peakWetness, survival.wetness),
  };
  return getSurvivalModifiers(activeSession.survival, input.biomeId, loadout);
}

/** Accumulate upright raft distance for journey-results scoring. */
export function recordUprightDistance(meters: number): void {
  if (!activeSession || !Number.isFinite(meters) || meters <= 0) return;
  activeSession = {
    ...activeSession,
    uprightDistanceMeters: activeSession.uprightDistanceMeters + meters,
  };
}

export interface JourneyResultsSummary {
  mapId: MapRegistryId;
  launchHour: number;
  peakWetness: number;
  uprightDistanceMeters: number;
  cachesRetrieved: number;
  cachesLost: number;
  cacheRetrievalBonus: number;
}

export function getJourneyResultsSummary(): JourneyResultsSummary | null {
  if (!activeSession) return null;
  const retrieved = activeSession.portageCache.cacheSlots.filter((s) => s.status === 'retrieved').length;
  const lost = activeSession.portageCache.cacheSlots.filter((s) => s.status === 'lost').length;
  return {
    mapId: activeSession.mapId,
    launchHour: activeSession.launchHour,
    peakWetness: activeSession.peakWetness,
    uprightDistanceMeters: activeSession.uprightDistanceMeters,
    cachesRetrieved: retrieved,
    cachesLost: lost,
    cacheRetrievalBonus: totalCacheRetrievalBonus(activeSession.portageCache),
  };
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
