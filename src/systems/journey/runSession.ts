/**
 * runSession.ts — Per-run session state (launch hour, cache placements, survival).
 *
 * Not written to Zustand each frame; initialized at run start from persistence +
 * StartMenu choices, then read by forecast / scoring / physics systems.
 */

import { wallClockEpochMs } from '../../utils/wallClock';
import { ACTIVE_MAP_ID, getMapDefinition, type MapDefinition, type MapRegistryId } from '../../maps/registry';
import { getMapSurvivalMetadata } from '../../maps/survivalMetadata';
import { buildCampaignStack } from '../../maps/campaign';
import { buildLaunchForecast } from '../map/flowForecast';
import {
  applyForecastToCacheSlots,
  applyForecastToPortageRoutes,
} from '../map/forecastCachePlacement';
import {
  createPortageCacheRunState,
  placeCache,
  reducePortageCacheState,
  totalCacheRetrievalBonus,
  type PortageCacheEvent,
  type PortageCacheRunState,
  DEFAULT_MAX_CACHE_PLACEMENTS,
} from '../survival/portageCache';
import {
  getLaunchHour,
  getLaunchWeather,
  markMapCompleted,
  pruneDailyRecords,
  setLastMapId,
} from '../persistence/PersistenceSystem';
import type { RunWeather } from '../map/weatherInflow';
import { DEFAULT_FORECAST_INPUTS } from '../../constants/forecast';
import {
  constantWeatherScript,
  launchWeatherOf,
  weatherScriptFairnessKey,
  type WeatherScript,
} from '../weather/weatherScript';
import {
  getDirectorRiverWeather,
  resetWeatherDirector,
  resetWeatherDirectorForTests,
} from '../weather/weatherDirector';
import { getMapAtmosphere } from '../../maps/atmosphere';
import { getActiveUserRiver, userRiverMapDefinition } from '../map/userRiverSession';
import { resetSkyClock, resetSkyClockForTests, setSkyAtmosphere } from '../sky/skyClock';
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
} from '../survival';
import { resetWetnessMuffle, setSfxWetnessMultiplier } from '../audio/wetnessMuffle';

export type JourneyMode = 'single' | 'journey';

export interface JourneyCheckpoint {
  mapId: MapRegistryId;
  segmentIndex: number;
  score: number;
  survival: SurvivalState;
  savedAtMs: number;
}

/**
 * What the day brings to the river: the weather script and the forecast's
 * melt inputs. Fixed at launch; the launch picker's weather is a one-step
 * script and the inputs default to DEFAULT_FORECAST_INPUTS.
 */
export interface RunConditions {
  weatherScript: WeatherScript;
  /** Air temperature (°C) driving the forecast's melt. */
  temperature: number;
  /** 0..1 snowpack left to melt. */
  snowpackIndex: number;
  /** UTC date (`YYYY-MM-DD`) of the Daily River this run is; absent for a free run. */
  dailyKey?: string;
}

export const DEFAULT_RUN_CONDITIONS: Readonly<RunConditions> = Object.freeze({
  weatherScript: constantWeatherScript(),
  temperature: DEFAULT_FORECAST_INPUTS.temperature,
  snowpackIndex: DEFAULT_FORECAST_INPUTS.snowpackIndex,
});

/**
 * Ghost fairness key for a run's conditions: the weather script's key, plus
 * the melt inputs when they differ from the default day. The launch picker's
 * runs (one-step script, default melt) key exactly as their weather always did.
 */
export function runConditionsFairnessKey(conditions: RunConditions): string {
  const parts: string[] = [];
  const weather = weatherScriptFairnessKey(conditions.weatherScript);
  if (weather) parts.push(weather);
  if (
    conditions.temperature !== DEFAULT_RUN_CONDITIONS.temperature ||
    conditions.snowpackIndex !== DEFAULT_RUN_CONDITIONS.snowpackIndex
  ) {
    parts.push(`melt:${conditions.temperature.toFixed(1)}/${conditions.snowpackIndex.toFixed(2)}`);
  }
  // A day's river is that day's: its bed carries every earlier day's erosion.
  if (conditions.dailyKey) parts.push(`day:${conditions.dailyKey}`);
  return parts.join('|');
}

export interface RunSessionSnapshot {
  /**
   * One per `initRunSession`, stable for the run. The snapshot object itself is
   * replaced on every update (survival ticks each frame), so anything that must
   * rebuild once per run — the river router — keys on this, never on identity.
   */
  runId: number;
  mapId: MapRegistryId;
  launchHour: number;
  /** The weather in force at launch (step 0 of the script, #464). */
  weather: RunWeather;
  /** Weather script + forecast inputs for the run; WeatherDirector steps the script. */
  conditions: RunConditions;
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
let nextRunId = 1;

export function initRunSession(options: {
  mapId: MapRegistryId;
  launchHour?: number;
  /** Launch weather as a one-step script; ignored when `conditions` carries a script. */
  weather?: RunWeather;
  /** The day's conditions (Daily River, replay); missing fields take the defaults. */
  conditions?: Partial<RunConditions>;
  placedCacheIds?: string[];
  loadoutId?: LoadoutId | string;
  journeyMode?: JourneyMode;
}): RunSessionSnapshot {
  // A new run starts dry — never inherit the last run's muffle.
  resetWetnessMuffle();

  const journeyMode = options.journeyMode ?? 'single';
  const mapStack =
    journeyMode === 'journey' ? buildCampaignStack(options.mapId) : [options.mapId];
  const startMapId = mapStack[0] ?? options.mapId;

  const survival = getMapSurvivalMetadata(startMapId);
  const launchHour = normalizeHour(options.launchHour ?? getLaunchHour());
  const conditions: RunConditions = {
    weatherScript:
      options.conditions?.weatherScript ?? constantWeatherScript(options.weather ?? getLaunchWeather()),
    temperature: options.conditions?.temperature ?? DEFAULT_RUN_CONDITIONS.temperature,
    snowpackIndex: options.conditions?.snowpackIndex ?? DEFAULT_RUN_CONDITIONS.snowpackIndex,
  };
  if (options.conditions?.dailyKey) {
    conditions.dailyKey = options.conditions.dailyKey;
    // A week of days stays on the device; older days' records go.
    pruneDailyRecords(conditions.dailyKey);
  }
  const forecastState =
    buildLaunchForecast({
      temperature: conditions.temperature,
      snowpackIndex: conditions.snowpackIndex,
      damReleaseSchedule: [{ hour: 14, release: 0.35 }],
      startHour: launchHour,
      horizonHours: 1,
    })[0]?.state ?? 'Normal';
  const maxPlacements = survival.maxCachePlacements ?? DEFAULT_MAX_CACHE_PLACEMENTS;
  const loadoutId = resolveLoadoutId(options.loadoutId);

  let portageCache = createPortageCacheRunState({
    cacheSlots: applyForecastToCacheSlots(survival.cacheSlots, forecastState),
    portageRoutes: applyForecastToPortageRoutes(survival.portageRoutes, forecastState),
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
    runId: nextRunId++,
    mapId: startMapId,
    launchHour,
    weather: launchWeatherOf(conditions.weatherScript),
    conditions,
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
  raftInWater = false;
  resetWeatherDirector(conditions.weatherScript);
  // The sun starts at the launch hour over the start map and runs on sim time.
  resetSkyClock(launchHour, getMapAtmosphere(startMapId));
  return activeSession;
}

export function getRunSession(): RunSessionSnapshot | null {
  return activeSession;
}

/**
 * The map this run is on: the session's, else the code default (no run yet, or
 * a unit test), or the player's river loaded over it (userRiverSession.ts).
 * Prefer this to the registry's static `getActiveMap()` anywhere
 * the answer depends on which map the player picked.
 */
export function getRunMap(): MapDefinition {
  const mapId = activeSession?.mapId ?? ACTIVE_MAP_ID;
  // A player's river, when one is loaded, is the run's map over its backing id.
  const river = getActiveUserRiver();
  return river ? userRiverMapDefinition(river, mapId) : getMapDefinition(mapId);
}

export function isJourneyMode(): boolean {
  return activeSession?.journeyMode === 'journey';
}

export function getActiveLaunchHour(): number {
  return activeSession?.launchHour ?? getLaunchHour();
}

/**
 * The river's weather right now: the director's (it ramps through the run's
 * script), or the persisted launch weather before any run.
 */
export function getActiveWeather(): RunWeather {
  return activeSession ? getDirectorRiverWeather() : getLaunchWeather();
}

/** The run's weather script (a one-step script before any run). */
export function getActiveWeatherScript(): WeatherScript {
  return activeSession?.conditions.weatherScript ?? constantWeatherScript(getLaunchWeather());
}

/** The run's conditions, or the defaults with the persisted launch weather before any run. */
export function getActiveConditions(): RunConditions {
  if (activeSession) return activeSession.conditions;
  return { ...DEFAULT_RUN_CONDITIONS, weatherScript: constantWeatherScript(getLaunchWeather()) };
}

/** Restart the run's weather from the top of its script (journey loop / map restart). */
export function restartRunWeather(): void {
  if (activeSession) resetWeatherDirector(activeSession.conditions.weatherScript);
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

/**
 * Integrate the run's survival by one sim step (wetness, core temperature, peak
 * exposure, the SFX muffle) and return the modifiers it now implies; null with
 * no run. Called once per fixed step by SimCore's `survival` system
 * (survivalSystem.ts) — nothing else may integrate it, or time runs twice.
 */
export function stepRunSurvival(input: Omit<SurvivalTickInput, 'launchHour'>): SurvivalModifiers | null {
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
  // Wetness SFX muffling (#301 leftover): the modifier has been derived here
  // all along; this is the one line that lets the mixer hear it.
  setSfxWetnessMultiplier(mods.sfxWetnessMultiplier);
  if (mods.exposureStress > activeSession.peakExposureStress) {
    activeSession = {
      ...activeSession,
      peakExposureStress: mods.exposureStress,
    };
  }
  return mods;
}

/** What the raft last said about its float (the raft's own state is out of SimCore's reach). */
let raftInWater = false;

/** The raft's last-published `inWater` (see `tickRunSurvival`). */
export function getPublishedRaftInWater(): boolean {
  return raftInWater;
}

/**
 * The vehicles' survival hook: the modifiers the last sim step produced for
 * `input.biomeId`, null with no run. It no longer integrates (that is
 * `stepRunSurvival`, one SimCore step at a time); the runner and raft keep
 * calling it with their probe, and the raft's `inWater` — the one input only
 * its hull knows — is kept here for the survival system's next step.
 * `dt`, `windSpeed` and the runner's `inWater` are read by the sim instead.
 */
export function tickRunSurvival(input: Omit<SurvivalTickInput, 'launchHour'>): SurvivalModifiers | null {
  raftInWater = input.inWater;
  return getActiveSurvivalModifiers(input.biomeId);
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
  // Same time of day, the next map's sky.
  setSkyAtmosphere(getMapAtmosphere(nextMapId));

  const checkpoint: JourneyCheckpoint = {
    mapId: nextMapId,
    segmentIndex,
    score,
    survival: { ...previousSurvival },
    savedAtMs: wallClockEpochMs(),
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
    savedAtMs: wallClockEpochMs(),
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
  raftInWater = false;
  awardedCacheSegments = new Set();
  resetWetnessMuffle();
  resetWeatherDirectorForTests();
  resetSkyClockForTests();
}

function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  const wrapped = Math.floor(hour) % 24;
  return wrapped < 0 ? wrapped + 24 : wrapped;
}
