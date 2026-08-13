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
  totalCacheRetrievalBonus,
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
  /** Peak wetness observed during the run (0–1). */
  peakWetness: number;
  /** Meters traveled while raft was upright (tip danger not active). */
  uprightDistanceMeters: number;
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
    peakWetness: 0,
    uprightDistanceMeters: 0,
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
  const mods = getSurvivalModifiers(activeSession.survival, input.biomeId, loadout);
  if (mods.exposureStress > activeSession.peakExposureStress) {
    activeSession = {
      ...activeSession,
      peakExposureStress: mods.exposureStress,
    };
  }
  return mods;
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

/**
 * Dry gear + a hot drink. Retrieving a cache is the only mid-run way to undo
 * wetness, which is what makes placing one before a cold reach a real decision:
 * you trade a scoring bonus slot for insurance against the glacier leg.
 */
export const CACHE_WETNESS_RECOVERY = 0.45;
export const CACHE_WARMTH_RECOVERY = 0.25;

/**
 * Apply a retrieved cache's survival relief. Returns the new survival state, or
 * null when no run is active. Idempotence is the caller's job — retrieval is
 * gated by the state machine, which only flips a slot to 'retrieved' once.
 */
export function applyCacheRecovery(): SurvivalState | null {
  if (!activeSession) return null;
  const survival = {
    wetness: Math.max(0, activeSession.survival.wetness - CACHE_WETNESS_RECOVERY),
    coreTemp: Math.min(1, activeSession.survival.coreTemp + CACHE_WARMTH_RECOVERY),
  };
  activeSession = { ...activeSession, survival };
  return survival;
}

/** Live portage/cache state — read by the world markers. */
export function getPortageCacheState(): PortageCacheRunState | null {
  return activeSession?.portageCache ?? null;
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
