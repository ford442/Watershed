/**
 * runContext.ts — Active map + procedural seed identity for per-run persistence.
 */

import { ACTIVE_MAP_ID, type MapRegistryId } from '../maps/registry';
import { parseUrlMapId, resolveMapId } from '../maps/campaign';
import { DEFAULT_MAP_CONFIG } from '../systems/MapSystem';
import { buildRunKey, getLastMapId } from '../systems/PersistenceSystem';

/** Parse `?seed=` from the URL; returns null when absent or invalid. */
export function parseUrlSeed(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Base seed driving procedural generation (URL override or default). */
export function getProceduralBaseSeed(): number {
  return parseUrlSeed() ?? DEFAULT_MAP_CONFIG.seed;
}

/**
 * Active map id shared by scoring/persistence and TrackManager defaults.
 * URL `?map=` and last-played persistence share one resolver with StartMenu.
 */
export function getActiveMapId(selection?: MapRegistryId | null): MapRegistryId {
  return resolveMapId({
    selection: selection ?? null,
    urlMap: parseUrlMapId(),
    lastPlayed: getLastMapId() ?? null,
    fallback: ACTIVE_MAP_ID,
  });
}

/** Persistence key for the active map + seed (`meander:12345`). */
export function getActiveRunKey(mapId: MapRegistryId = getActiveMapId()): string {
  return buildRunKey(mapId, getProceduralBaseSeed());
}
