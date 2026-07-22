/**
 * PersistenceSystem.ts — Versioned, schema-validated localStorage for Watershed saves.
 *
 * Stores per-map/seed bests, ghost payloads, graphics settings, vehicle preference,
 * ghost visibility, and campaign progress (last map + completed maps).
 * Hydrates Zustand on boot; debounced subscribe for writes.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import persistenceSchema from '../formats/persistence.schema.json';
import type { GameSettings } from './GameState';

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
  ghostData?: string;
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
  runs: Record<string, RunBest>;
}

// =============================================================================
// AJV
// =============================================================================

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validatePersistence = ajv.compile(persistenceSchema);

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
  if (!validatePersistence(raw)) return null;
  const payload = raw as unknown as PersistencePayload;
  if (!Array.isArray(payload.completedMaps)) {
    payload.completedMaps = [];
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
  if (!validatePersistence(next)) {
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
  const next: RunBest = {
    bestScore: Math.max(current.bestScore, patch.bestScore ?? current.bestScore),
    bestAirTime: Math.max(current.bestAirTime, patch.bestAirTime ?? current.bestAirTime),
    ghostData: patch.ghostData ?? current.ghostData,
  };

  touchCache((data) => {
    data.runs[runKey] = next;
  });
  flushPersistence();

  return next;
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

/** Test helper — reset module cache between unit tests. */
export function resetPersistenceForTests(): void {
  cache = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
