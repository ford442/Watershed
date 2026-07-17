/**
 * runContext.ts — Active map + procedural seed identity for per-run persistence.
 */

import { ACTIVE_MAP_ID, type MapRegistryId } from '../maps/registry';
import { DEFAULT_MAP_CONFIG } from '../systems/MapSystem';
import { buildRunKey } from '../systems/PersistenceSystem';

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

export function getActiveMapId(): MapRegistryId {
  return ACTIVE_MAP_ID;
}

/** Persistence key for the active map + seed (`meander:12345`). */
export function getActiveRunKey(mapId: MapRegistryId = getActiveMapId()): string {
  return buildRunKey(mapId, getProceduralBaseSeed());
}
