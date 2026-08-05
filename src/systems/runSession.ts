/**
 * runSession.ts — Per-run session state (launch hour, cache placements, survival).
 *
 * Not written to Zustand each frame; initialized at run start from persistence +
 * StartMenu choices, then read by forecast / scoring / physics systems.
 */

import type { MapRegistryId } from '../maps/registry';
import { getMapSurvivalMetadata } from '../maps/survivalMetadata';
import { buildCampaignStack } from '../maps/campaign';
import {
  createPortageCacheRunState,
  placeCache,
  reducePortageCacheState,
  type PortageCacheEvent,
  type PortageCacheRunState,
  DEFAULT_MAX_CACHE_PLACEMENTS,
} from './portageCache';
import { getLaunchHour, setLastMapId, markMapCompleted } from './PersistenceSystem';
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

export type JourneyMode = 'single' | 'journey';

export interface JourneyCheckpoint {
  mapId: MapRegistryId;
  segmentIndex: number;
  score: number;
  survival: SurvivalState;
  savedAtMs: number;
}

export interface RunSessionSnapshot {
  mapId: MapRegistryId;
  launchHour: number;
  placedCacheIds: string[];
  loadoutId: LoadoutId;
  portageCache: PortageCacheRunState;
  survival: SurvivalState;
  /** single = one map; journey = campaign chain with seamless handoffs. */
  journeyMode: JourneyMode;
  /** Ordered campaign stack when journeyMode === 'journey'. */
  mapStack: MapRegistryId[];
  currentMapIndex: number;
  /** Cumulative score across map boundaries (mirrors Zustand score in journey). */
  cumulativeScore: number;
  peakAirTime: number;
  peakExposureStress: number;
  /** Last autosave at a reach/map boundary. */
  lastCheckpoint: JourneyCheckpoint | null;
}

let activeSession: RunSessionSnapshot | null = null;
let awardedCacheSegments = new Set<number>();

export function initRunSession(options: {
  mapId: MapRegistryId;
  launchHour?: number;
  placedCacheIds?: string[];
  loadoutId?: LoadoutId | string;
  journeyMode?: JourneyMode;
}): RunSessionSnapshot {
  const journeyMode = options.journeyMode ?? 'single';
  const mapStack =
    journeyMode === 'journey' ? buildCampaignStack(options.mapId) : [options.mapId];
  const startMapId = mapStack[0] ?? options.mapId;

  const survival = getMapSurvivalMetadata(startMapId);
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
    mapId: startMapId,
    launchHour,
    placedCacheIds,
    loadoutId,
    portageCache,
    survival: createSurvivalState(),
    journeyMode,
    mapStack,
    currentMapIndex: 0,
    cumulativeScore: 0,
    peakAirTime: 0,
    peakExposureStress: 0,
    lastCheckpoint: null,
  };
  awardedCacheSegments = new Set();
  return activeSession;
}

export function getRunSession(): RunSessionSnapshot | null {
  return activeSession;
}

export function isJourneyMode(): boolean {
  return activeSession?.journeyMode === 'journey';
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
  activeSession = {
    ...activeSession,
    survival: tickSurvivalState(
      activeSession.survival,
      { ...input, launchHour: activeSession.launchHour },
      loadout,
    ),
  };
  const mods = getSurvivalModifiers(activeSession.survival, input.biomeId, loadout);
  if (mods.exposureStress > activeSession.peakExposureStress) {
    activeSession = {
      ...activeSession,
      peakExposureStress: mods.exposureStress,
    };
  }
  return mods;
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

/**
 * Advance to the next campaign map without resetting survival wetness/exposure.
 * Remaps portage caches for the new map metadata; preserves loadout + launch hour.
 */
export function advanceRunSessionMap(
  nextMapId: MapRegistryId,
  options?: { score?: number; segmentIndex?: number; airTime?: number },
): RunSessionSnapshot | null {
  if (!activeSession) return null;

  const previousSurvival = activeSession.survival;
  const survivalMeta = getMapSurvivalMetadata(nextMapId);
  const maxPlacements = survivalMeta.maxCachePlacements ?? DEFAULT_MAX_CACHE_PLACEMENTS;

  let portageCache = createPortageCacheRunState({
    cacheSlots: survivalMeta.cacheSlots,
    portageRoutes: survivalMeta.portageRoutes,
  });

  // Re-apply placements that still exist on the next map.
  const placedCacheIds: string[] = [];
  for (const slotId of activeSession.placedCacheIds) {
    if (portageCache.cacheSlots.some((slot) => slot.id === slotId && slot.status === 'unplaced')) {
      portageCache = placeCache(portageCache, slotId, maxPlacements);
      if (portageCache.cacheSlots.find((slot) => slot.id === slotId)?.status === 'placed') {
        placedCacheIds.push(slotId);
      }
    }
  }

  const stackIndex = activeSession.mapStack.indexOf(nextMapId);
  const currentMapIndex =
    stackIndex >= 0 ? stackIndex : Math.min(activeSession.currentMapIndex + 1, activeSession.mapStack.length - 1);

  const score = options?.score ?? activeSession.cumulativeScore;
  const segmentIndex = options?.segmentIndex ?? 0;
  const airTime = options?.airTime ?? activeSession.peakAirTime;

  markMapCompleted(activeSession.mapId);
  setLastMapId(nextMapId);

  const checkpoint: JourneyCheckpoint = {
    mapId: nextMapId,
    segmentIndex,
    score,
    survival: { ...previousSurvival },
    savedAtMs: Date.now(),
  };

  activeSession = {
    ...activeSession,
    mapId: nextMapId,
    placedCacheIds,
    portageCache,
    // Preserve wetness / coreTemp across the boundary (AC).
    survival: previousSurvival,
    currentMapIndex,
    cumulativeScore: score,
    peakAirTime: Math.max(activeSession.peakAirTime, airTime),
    lastCheckpoint: checkpoint,
  };
  awardedCacheSegments = new Set();
  return activeSession;
}

/** Autosave checkpoint at a reach/map boundary without changing the active map. */
export function saveJourneyCheckpoint(options: {
  mapId?: MapRegistryId;
  segmentIndex: number;
  score: number;
}): JourneyCheckpoint | null {
  if (!activeSession) return null;
  const checkpoint: JourneyCheckpoint = {
    mapId: options.mapId ?? activeSession.mapId,
    segmentIndex: options.segmentIndex,
    score: options.score,
    survival: { ...activeSession.survival },
    savedAtMs: Date.now(),
  };
  activeSession = {
    ...activeSession,
    cumulativeScore: options.score,
    lastCheckpoint: checkpoint,
  };
  setLastMapId(checkpoint.mapId);
  return checkpoint;
}

export function notePeakAirTime(seconds: number): void {
  if (!activeSession || !Number.isFinite(seconds)) return;
  if (seconds > activeSession.peakAirTime) {
    activeSession = { ...activeSession, peakAirTime: seconds };
  }
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
