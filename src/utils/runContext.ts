/**
 * runContext.ts — Active map + procedural seed identity for per-run persistence.
 */

import { ACTIVE_MAP_ID, type MapRegistryId } from '../maps/registry';
import { parseUrlMapId, resolveMapId } from '../maps/campaign';
import { DEFAULT_MAP_CONFIG } from '../systems/map/MapSystem';
import { buildRunKey, getLastMapId } from '../systems/persistence/PersistenceSystem';
import { getRunSession } from '../systems/journey/runSession';

/** Parse `?seed=` from the URL; returns null when absent or invalid. */
export function parseUrlSeed(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

let seedOverride: number | null = null;
let vehicleOverride: 'runner' | 'raft' | null = null;

/** Pin the vehicle for this page (a `?replay=` runs its ghost's vehicle); null releases it. */
export function setVehicleOverride(vehicle: 'runner' | 'raft' | null): void {
  vehicleOverride = vehicle;
}

/** The pinned vehicle, if any (wins over `?vehicle=` and the map's preference). */
export function getVehicleOverride(): 'runner' | 'raft' | null {
  return vehicleOverride;
}

/** Pin the procedural seed for this page (a `?replay=` plays its ghost's seed); null releases it. */
export function setProceduralSeedOverride(seed: number | null): void {
  seedOverride = seed !== null && Number.isFinite(seed) ? Math.floor(seed) : null;
}

/** Base seed driving procedural generation (replay pin, URL override, or default). */
export function getProceduralBaseSeed(): number {
  return seedOverride ?? parseUrlSeed() ?? DEFAULT_MAP_CONFIG.seed;
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

/** Persistence key for a Daily River run (`meander@2026-10-21:12345`): each day keeps its own best. */
export function dailyRunKey(mapId: MapRegistryId, dateKey: string): string {
  return buildRunKey(`${mapId}@${dateKey}`, getProceduralBaseSeed());
}

/** Persistence key for the active map + seed (`meander:12345`), or the day's key on a Daily River run. */
export function getActiveRunKey(mapId: MapRegistryId = getActiveMapId()): string {
  const dailyKey = getRunSession()?.conditions.dailyKey;
  if (dailyKey) return dailyRunKey(mapId, dailyKey);
  return buildRunKey(mapId, getProceduralBaseSeed());
}
