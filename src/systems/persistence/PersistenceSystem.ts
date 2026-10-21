/**
 * PersistenceSystem.ts — Versioned, schema-validated localStorage for Watershed saves.
 *
 * Stores per-map/seed bests, ghost payloads, graphics settings, vehicle preference,
 * ghost visibility, and campaign progress (last map + completed maps).
 * Hydrates Zustand on boot; debounced subscribe for writes.
 */

import type { GameSettings } from '../GameState';
import type { RunSplitEntry } from '../ghost/ghostCodec';
import type { WsGhostFile } from '../ghost/ghostExport';
import { launchHourOverride } from '../../utils/launchHourOverride';
import { launchWeatherOverride } from '../../utils/launchWeatherOverride';
import { DEFAULT_WEATHER_INTENSITY, type RunWeather } from '../map/weatherInflow';
import type { WeatherType } from '../../constants/weather';

// =============================================================================
// TYPES
// =============================================================================

export const PERSISTENCE_VERSION = 1 as const;
export const STORAGE_KEY = 'watershed_save_v1';
const LEGACY_HIGH_SCORE_KEY = 'watershed_highscore';
const PERSIST_DEBOUNCE_MS = 400;

export interface RunBest {
  bestScore: number;
  bestAirTime: number;
  /** Fastest completion time in milliseconds (lower = better). Absent until first timed finish. */
  bestTimeMs?: number;
  ghostData?: string;
  /** Checkpoint splits from the run that set bestTimeMs. Absent until a timed PB exists. */
  splits?: RunSplitEntry[];
  /** Launch hour of the run that set bestTimeMs — PB ghost hides at other hours (#438). */
  launchHour?: number;
  /** hydroEvents hash of the run that set bestTimeMs. */
  hydroEventHash?: string;
}

export interface PersistencePayload {
  version: typeof PERSISTENCE_VERSION;
  settings: GameSettings;
  vehicleType: 'runner' | 'raft';
  ghostEnabled: boolean;
  /** Last map selected or completed — used by StartMenu / map resolver. */
  lastMapId?: string;
  /** Soft-lock progress for campaign maps. */
  completedMaps?: string[];
  /** Last selected pre-run launch hour (0–23). */
  launchHour?: number;
  /** Last selected pre-run weather (#464). Absent = clear. */
  launchWeather?: WeatherType;
  runs: Record<string, RunBest>;
  /** Last imported rival `.wsghost` per map id — offline-only, no accounts/server. */
  rivals?: Record<string, WsGhostFile>;
}

// =============================================================================
// SHAPE GUARD
// =============================================================================

// #485 C: this is our own tiny shape, not a schema we load from elsewhere, so it is
// checked by hand instead of shipping an Ajv compiler to every player. It mirrors
// formats/persistence.schema.json exactly (the schema stays as the written contract);
// PersistenceSystem.guard.test.ts cross-checks the two on a mutation corpus.
// Ajv semantics reproduced on purpose: a key set to `undefined` counts as absent, an
// unknown key is rejected even when undefined, and (the old compiler ran `strict: false`,
// which also turns off `strictNumbers`) any `typeof === 'number'` counts as a number,
// NaN and Infinity included — `minimum`/`maximum` still bound them where the schema has any.

const QUALITIES = ['low', 'medium', 'high', 'ultra'] as const;
const WEATHERS = ['clear', 'rain', 'fog', 'storm', 'snow'] as const;

type Check = (v: unknown) => boolean;
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isInteger = (v: unknown): v is number => typeof v === 'number' && !(v % 1) && !Number.isNaN(v);
const numberMin = (min: number): Check => (v) => isNumber(v) && v >= min;
const integerIn = (min: number, max: number): Check => (v) => isInteger(v) && v >= min && v <= max;
const nonEmptyString: Check = (v) => typeof v === 'string' && v.length >= 1;
const stringMaxLength = (max: number): Check => (v) => typeof v === 'string' && [...v].length <= max;
const oneOf = (values: readonly string[]): Check => (v) => typeof v === 'string' && values.includes(v);
const isBoolean: Check = (v) => typeof v === 'boolean';

/** Object whose keys are exactly `fields` (no extras); `undefined` values count as absent. */
function shape(fields: Record<string, Check>, required: readonly string[]): Check {
  return (v) => {
    if (!isObject(v)) return false;
    for (const key of Object.keys(v)) if (!Object.prototype.hasOwnProperty.call(fields, key)) return false;
    for (const key of required) if (v[key] === undefined) return false;
    for (const [key, check] of Object.entries(fields)) {
      if (v[key] !== undefined && !check(v[key])) return false;
    }
    return true;
  };
}

/** Object used as a string-keyed map whose every value must satisfy `check`. */
const mapOf = (check: Check): Check => (v) => isObject(v) && Object.keys(v).every((k) => check(v[k]));
const arrayOf = (check: Check, unique = false): Check => (v) => {
  if (!Array.isArray(v)) return false;
  // Index loop, not `.every`: Ajv visits holes of a sparse array as `undefined` (invalid).
  for (let i = 0; i < v.length; i++) if (!check(v[i])) return false;
  return !unique || new Set(v).size === v.length;
};

const isRunSplits = arrayOf(
  shape({ segmentIndex: isNumber, tMs: numberMin(0), speed: isNumber }, ['segmentIndex', 'tMs', 'speed']),
);

const isPersistenceShape = shape(
  {
    version: (v) => v === PERSISTENCE_VERSION,
    settings: shape({ quality: oneOf(QUALITIES), soundVolume: (v) => isNumber(v) && v >= 0 && v <= 1 }, [
      'quality',
      'soundVolume',
    ]),
    vehicleType: oneOf(['runner', 'raft']),
    ghostEnabled: isBoolean,
    lastMapId: nonEmptyString,
    completedMaps: arrayOf(nonEmptyString, true),
    launchHour: integerIn(0, 23),
    launchWeather: oneOf(WEATHERS),
    runs: mapOf(
      shape(
        {
          bestScore: numberMin(0),
          bestAirTime: numberMin(0),
          bestTimeMs: numberMin(0),
          ghostData: nonEmptyString,
          splits: isRunSplits,
          launchHour: integerIn(0, 23),
          hydroEventHash: stringMaxLength(32),
        },
        ['bestScore', 'bestAirTime'],
      ),
    ),
    rivals: mapOf(
      shape(
        {
          codecVersion: numberMin(1),
          mapId: nonEmptyString,
          timeMs: numberMin(0),
          ghostData: nonEmptyString,
          exportedAt: isNumber,
          splits: isRunSplits,
          launchHour: integerIn(0, 23),
          hydroEventHash: stringMaxLength(32),
          qualityPreset: oneOf(QUALITIES),
        },
        ['codecVersion', 'mapId', 'timeMs', 'ghostData', 'exportedAt'],
      ),
    ),
  },
  ['version', 'settings', 'vehicleType', 'ghostEnabled', 'runs'],
);

/** Does `value` have the persisted-save shape (`persistence.schema.json`)? */
export function isPersistencePayload(value: unknown): boolean {
  return isPersistenceShape(value);
}

// =============================================================================
// IN-MEMORY CACHE (single source between reads/writes)
// =============================================================================

let cache: PersistencePayload | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const DEFAULT_SETTINGS: GameSettings = {
  quality: 'high',
  soundVolume: 0.8,
};

export function getDefaultPersistence(): PersistencePayload {
  return {
    version: PERSISTENCE_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    vehicleType: 'runner',
    ghostEnabled: true,
    lastMapId: undefined,
    completedMaps: [],
    launchHour: 6,
    runs: {},
  };
}

// =============================================================================
// RUN KEYS
// =============================================================================

/** Stable key for map + procedural seed bests (`meander:12345`). */
export function buildRunKey(mapId: string, seed: number): string {
  return `${mapId}:${Math.floor(seed)}`;
}

// =============================================================================
// LOAD / SAVE
// =============================================================================

function normalizePayload(raw: unknown): PersistencePayload | null {
  if (!isPersistencePayload(raw)) return null;
  const payload = raw as unknown as PersistencePayload;
  if (!Array.isArray(payload.completedMaps)) {
    payload.completedMaps = [];
  }
  if (payload.launchHour === undefined) {
    payload.launchHour = 6;
  } else {
    payload.launchHour = Math.max(0, Math.min(23, Math.floor(payload.launchHour)));
  }
  return payload;
}

export function loadPersistence(): PersistencePayload {
  if (cache) return cache;

  if (typeof window === 'undefined') {
    cache = getDefaultPersistence();
    return cache;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = normalizePayload(JSON.parse(stored));
      if (parsed) {
        cache = parsed;
        return cache;
      }
      console.warn('[Persistence] Discarding invalid or outdated save payload');
    }
  } catch (error) {
    console.warn('[Persistence] Failed to read save data', error);
  }

  cache = migrateLegacyHighScore(getDefaultPersistence());
  flushPersistence();
  return cache;
}

function flushPersistence(): void {
  if (typeof window === 'undefined' || !cache) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('[Persistence] Failed to write save data', error);
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPersistence();
  }, PERSIST_DEBOUNCE_MS);
}

export function savePersistence(next: PersistencePayload): void {
  if (!isPersistencePayload(next)) {
    console.warn('[Persistence] Refusing to save invalid payload');
    return;
  }
  cache = next;
  flushPersistence();
}

/** Write through the validated cache (used by bootstrap debounce). */
export function initPersistenceStore(next: PersistencePayload): void {
  savePersistence(next);
}

function touchCache(mutator: (data: PersistencePayload) => void): PersistencePayload {
  const data = loadPersistence();
  mutator(data);
  cache = data;
  schedulePersist();
  return data;
}

// =============================================================================
// LEGACY MIGRATION
// =============================================================================

function migrateLegacyHighScore(data: PersistencePayload): PersistencePayload {
  if (typeof window === 'undefined') return data;

  try {
    const raw = window.localStorage.getItem(LEGACY_HIGH_SCORE_KEY);
    if (!raw) return data;

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return data;

    const legacyKey = buildRunKey('meander', 12345);
    const existing = data.runs[legacyKey]?.bestScore ?? 0;
    if (parsed > existing) {
      data.runs[legacyKey] = {
        bestScore: parsed,
        bestAirTime: data.runs[legacyKey]?.bestAirTime ?? 0,
        ghostData: data.runs[legacyKey]?.ghostData,
      };
    }

    window.localStorage.removeItem(LEGACY_HIGH_SCORE_KEY);
  } catch {
    // ignore migration errors
  }

  return data;
}

// =============================================================================
// RUN BEST HELPERS
// =============================================================================

export function getRunBest(runKey: string): RunBest {
  const data = loadPersistence();
  return data.runs[runKey] ?? { bestScore: 0, bestAirTime: 0 };
}

export function updateRunBest(runKey: string, patch: Partial<RunBest>): RunBest {
  const current = getRunBest(runKey);

  let bestTimeMs: number | undefined;
  if (patch.bestTimeMs !== undefined && current.bestTimeMs !== undefined) {
    bestTimeMs = Math.min(current.bestTimeMs, patch.bestTimeMs);
  } else {
    bestTimeMs = patch.bestTimeMs ?? current.bestTimeMs;
  }

  const next: RunBest = {
    bestScore: Math.max(current.bestScore, patch.bestScore ?? current.bestScore),
    bestAirTime: Math.max(current.bestAirTime, patch.bestAirTime ?? current.bestAirTime),
    bestTimeMs,
    ghostData: patch.ghostData ?? current.ghostData,
  };

  touchCache((data) => {
    data.runs[runKey] = next;
  });
  flushPersistence();

  return next;
}

/**
 * Persist a ghost payload (and its checkpoint splits) only when the new run
 * time is a personal best (lower is better).
 * Returns true when the ghost was updated, false when the existing PB is retained.
 *
 * `splits` is optional so existing 3-arg call sites keep compiling; omitting it
 * leaves any previously-stored splits untouched instead of clearing them.
 */
export function updatePBGhost(
  runKey: string,
  timeMs: number,
  ghostData: string,
  splits?: RunSplitEntry[],
  fairness?: { launchHour?: number; hydroEventHash?: string },
): boolean {
  const current = getRunBest(runKey);
  if (current.bestTimeMs !== undefined && current.bestTimeMs <= timeMs) {
    return false;
  }
  touchCache((data) => {
    const run = data.runs[runKey] ?? { bestScore: 0, bestAirTime: 0 };
    const next: RunBest = {
      ...run,
      bestTimeMs: timeMs,
      ghostData,
      splits: splits ?? run.splits,
    };
    // A new PB replaces the old one's river: never keep a stale hour/hash.
    delete next.launchHour;
    delete next.hydroEventHash;
    if (fairness?.launchHour !== undefined) next.launchHour = fairness.launchHour;
    if (fairness?.hydroEventHash) next.hydroEventHash = fairness.hydroEventHash;
    data.runs[runKey] = next;
  });
  flushPersistence();
  return true;
}

export function setRunGhostData(runKey: string, ghostData: string): void {
  touchCache((data) => {
    const current = data.runs[runKey] ?? { bestScore: 0, bestAirTime: 0 };
    data.runs[runKey] = { ...current, ghostData };
  });
  flushPersistence();
}

export function getRunGhostData(runKey: string): string | undefined {
  return getRunBest(runKey).ghostData;
}

// =============================================================================
// CAMPAIGN PROGRESS
// =============================================================================

export function getLastMapId(): string | undefined {
  return loadPersistence().lastMapId;
}

export function setLastMapId(mapId: string): void {
  touchCache((data) => {
    data.lastMapId = mapId;
  });
  flushPersistence();
}

export function getCompletedMaps(): string[] {
  return [...(loadPersistence().completedMaps ?? [])];
}

/** Marks a map complete (idempotent) and remembers it as last played. */
export function markMapCompleted(mapId: string): string[] {
  let next: string[] = [];
  touchCache((data) => {
    const current = data.completedMaps ?? [];
    next = current.includes(mapId) ? [...current] : [...current, mapId];
    data.completedMaps = next;
    data.lastMapId = mapId;
  });
  flushPersistence();
  return next;
}

export function getLaunchHour(): number {
  // `?hour=` wins for this page load only — scouting / visual smoke (#398).
  const override = launchHourOverride();
  if (override !== null) return override;
  return loadPersistence().launchHour ?? 6;
}

export function setLaunchHour(hour: number): number {
  const normalized = Math.max(0, Math.min(23, Math.floor(hour)));
  touchCache((data) => {
    data.launchHour = normalized;
  });
  flushPersistence();
  return normalized;
}

export function getLaunchWeather(): RunWeather {
  // `?weather=` wins for this page load only — scouting / smoke (#464).
  const override = launchWeatherOverride();
  if (override !== null) return override;
  const type = loadPersistence().launchWeather ?? 'clear';
  return { type, intensity: DEFAULT_WEATHER_INTENSITY[type] };
}

export function setLaunchWeather(type: WeatherType): WeatherType {
  touchCache((data) => {
    if (type === 'clear') delete data.launchWeather;
    else data.launchWeather = type;
  });
  flushPersistence();
  return type;
}

// =============================================================================
// DAILY RIVER (one river per UTC day; its runs key as `mapId@YYYY-MM-DD:seed`)
// =============================================================================

/** Days of Daily River records kept on the device (today included). */
export const DAILY_KEEP_DAYS = 7;
const DAILY_RUN_KEY = /@(\d{4}-\d{2}-\d{2}):/;

/** The UTC date `days` before `dateKey` (`YYYY-MM-DD`). */
function dateKeyMinus(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Drop Daily River records older than the last `keepDays` days (counting
 * `todayKey`). Returns how many run entries went. Free-run bests never match.
 */
export function pruneDailyRecords(todayKey: string, keepDays: number = DAILY_KEEP_DAYS): number {
  const cutoff = dateKeyMinus(todayKey, keepDays - 1);
  let removed = 0;
  touchCache((data) => {
    for (const key of Object.keys(data.runs)) {
      const day = DAILY_RUN_KEY.exec(key)?.[1];
      if (day && day < cutoff) {
        delete data.runs[key];
        removed += 1;
      }
    }
  });
  if (removed > 0) flushPersistence();
  return removed;
}

/** Best score across all seeds for a map id (`mapId:*` run keys). */
export function getBestScoreForMap(mapId: string): number {
  const data = loadPersistence();
  const prefix = `${mapId}:`;
  let best = 0;
  for (const [key, run] of Object.entries(data.runs)) {
    if (key.startsWith(prefix)) {
      best = Math.max(best, run.bestScore ?? 0);
    }
  }
  return best;
}

/** Whether any ghost payload exists for this map (any seed). */
export function getGhostBestScoreForMap(mapId: string): number {
  const data = loadPersistence();
  const prefix = `${mapId}:`;
  let best = 0;
  for (const [key, run] of Object.entries(data.runs)) {
    if (key.startsWith(prefix) && run.ghostData) {
      best = Math.max(best, run.bestScore ?? 0);
    }
  }
  return best;
}

// =============================================================================
// RIVAL GHOST (Phase C — offline, one imported rival per map, no server)
// =============================================================================

/** Last imported rival ghost for a map, or undefined when none was loaded. */
export function getRivalGhost(mapId: string): WsGhostFile | undefined {
  return loadPersistence().rivals?.[mapId];
}

/** Remember an imported `.wsghost` as the rival to race for its map. */
export function setRivalGhost(mapId: string, file: WsGhostFile): void {
  touchCache((data) => {
    data.rivals = { ...(data.rivals ?? {}), [mapId]: file };
  });
  flushPersistence();
}

/** Drop the rival ghost for a map (e.g. after it's beaten, or on request). */
export function clearRivalGhost(mapId: string): void {
  touchCache((data) => {
    if (!data.rivals || !(mapId in data.rivals)) return;
    const next = { ...data.rivals };
    delete next[mapId];
    data.rivals = next;
  });
  flushPersistence();
}

/** Test helper — reset module cache between unit tests. */
export function resetPersistenceForTests(): void {
  cache = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
