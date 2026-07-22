/**
 * campaign.ts — Pure helpers for map resolution and end-of-map decisions.
 *
 * Shared by StartMenu, URL `?map=`, and journey-complete continue flow so
 * UI selection and deep links stay in parity without a Reach backend.
 */

import {
  ACTIVE_MAP_ID,
  MAP_REGISTRY,
  type MapDefinition,
  type MapRegistryId,
} from './registry';

export type MapDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface MapMenuEntry {
  id: MapRegistryId;
  label: string;
  difficulty: MapDifficulty;
  /** Estimated duration in seconds (from authored map metadata). */
  estimatedDurationSec: number;
  /** Soft-lock prerequisite map id, if any. */
  unlockAfter?: MapRegistryId;
  nextMapId?: MapRegistryId;
}

export type JourneyCompletionDecision =
  | {
      kind: 'continue';
      nextMapId: MapRegistryId;
      nextLabel: string;
    }
  | {
      kind: 'summary';
    };

const VALID_MAP_IDS = new Set<string>(Object.keys(MAP_REGISTRY));

/** True when `value` is a registered map id. */
export function isMapRegistryId(value: string | null | undefined): value is MapRegistryId {
  return typeof value === 'string' && VALID_MAP_IDS.has(value);
}

/**
 * Resolve which map to load.
 *
 * Priority: explicit menu/selection → URL `?map=` → last played → code fallback.
 * Invalid ids are ignored so a bad query string never crashes boot.
 */
export function resolveMapId(options: {
  selection?: string | null;
  urlMap?: string | null;
  lastPlayed?: string | null;
  fallback?: MapRegistryId;
} = {}): MapRegistryId {
  const fallback = options.fallback ?? ACTIVE_MAP_ID;
  if (isMapRegistryId(options.selection)) return options.selection;
  if (isMapRegistryId(options.urlMap)) return options.urlMap;
  if (isMapRegistryId(options.lastPlayed)) return options.lastPlayed;
  return fallback;
}

/** Parse `?map=` from a search string or the current window location. */
export function parseUrlMapId(search?: string): MapRegistryId | null {
  const raw =
    search ??
    (typeof window !== 'undefined' ? window.location.search : '');
  const value = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`).get('map');
  return isMapRegistryId(value) ? value : null;
}

/** Write `?map=` into the current URL without reloading (no-op off-window). */
export function syncMapUrl(mapId: MapRegistryId): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  params.set('map', mapId);
  const next = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
}

/**
 * Campaign continue target after `journeyComplete`.
 * Prefers explicit `nextMapId`, then `continuation.mapId` (glacial → meander).
 */
export function getContinuationTarget(mapId: MapRegistryId): MapRegistryId | null {
  const def = MAP_REGISTRY[mapId];
  if (!def) return null;
  if (def.nextMapId && isMapRegistryId(def.nextMapId)) return def.nextMapId;
  const fromContinuation = def.continuation?.mapId;
  if (fromContinuation && isMapRegistryId(fromContinuation)) return fromContinuation;
  return null;
}

/** Pure decision for the journey-complete overlay. */
export function getJourneyCompletionDecision(mapId: MapRegistryId): JourneyCompletionDecision {
  const nextMapId = getContinuationTarget(mapId);
  if (!nextMapId) return { kind: 'summary' };

  return {
    kind: 'continue',
    nextMapId,
    nextLabel: MAP_REGISTRY[nextMapId].label,
  };
}

/** Soft-lock: unlocked when prerequisite is absent or present in completedMaps. */
export function isMapUnlocked(mapId: MapRegistryId, completedMaps: readonly string[]): boolean {
  const def = MAP_REGISTRY[mapId];
  if (!def?.unlockAfter) return true;
  return completedMaps.includes(def.unlockAfter);
}

function difficultyFromMeta(def: MapDefinition): MapDifficulty {
  const raw = (def.difficulty ?? 'beginner').toLowerCase();
  if (raw === 'intermediate' || raw === 'medium') return 'intermediate';
  if (raw === 'advanced' || raw === 'hard') return 'advanced';
  if (raw === 'expert') return 'expert';
  return 'beginner';
}

/** Stable menu list for StartMenu (registry order). */
export function listMapsForMenu(): MapMenuEntry[] {
  return (Object.keys(MAP_REGISTRY) as MapRegistryId[]).map((id) => {
    const def = MAP_REGISTRY[id];
    return {
      id,
      label: def.label,
      difficulty: difficultyFromMeta(def),
      estimatedDurationSec: def.estimatedDurationSec ?? 300,
      unlockAfter: def.unlockAfter,
      nextMapId: getContinuationTarget(id) ?? undefined,
    };
  });
}

export function formatDuration(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  return `~${mins} min`;
}
