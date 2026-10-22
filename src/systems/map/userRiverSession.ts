/**
 * userRiverSession — the player's own river, registered for this session.
 *
 * A `.wsriver` is the level JSON the editor exports. Once validated
 * (userRiverImport.ts, a lazy chunk — the validator never rides the entry) it
 * is made the run's map here: `getRunMap()` resolves to it, so its segments,
 * biome and `hydroEvents` (vortex included) drive the treadmill, the SWE stage
 * and the HUD exactly as an authored map's do. A campaign map id still backs
 * the run for the parts that key on one (atmosphere, survival metadata); the
 * river's content hash keys its bests and its ghosts' fairness, so a ghost from
 * a different river — or another edit of this one — never races it.
 *
 * Module state, no Zustand: readers poll on run start, the world subscribes.
 */

import { getMapDefinition, type MapDefinition, type MapRegistryId } from '../../maps/registry';
import { normalizeBiomeId } from '../../configs/biomes';
import type { LevelData } from './MapSystem';

export interface UserRiver {
  /** Saved-level id (the editor's slug) or the file's name. */
  id: string;
  label: string;
  level: LevelData;
  /** Content hash of the level JSON — the river's identity for bests and ghosts. */
  hash: string;
}

let active: UserRiver | null = null;
const listeners = new Set<() => void>();

/**
 * FNV-1a over the level's JSON (stable for one parsed file: key order is the
 * file's). Eight hex digits are plenty to tell a friend's rivers apart.
 */
export function hashUserRiverLevel(level: LevelData): string {
  const text = JSON.stringify(level);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function createUserRiver(id: string, level: LevelData): UserRiver {
  return { id, label: level.metadata?.name || id, level, hash: hashUserRiverLevel(level) };
}

/** Make `river` the session's run map (null returns to the campaign). */
export function setActiveUserRiver(river: UserRiver | null): void {
  if (river === active) return;
  active = river;
  for (const listener of listeners) listener();
}

export function getActiveUserRiver(): UserRiver | null {
  return active;
}

export function subscribeUserRiver(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Persistence-key prefix for a river's bests: `river-<hash>` in place of a map id. */
export function userRiverRunKeyId(river: UserRiver): string {
  return `river-${river.hash}`;
}

/** The fairness-key part a user river adds to its ghosts (`river:<hash>`). */
export function userRiverFairnessPart(river: UserRiver | null = active): string {
  return river ? `river:${river.hash}` : '';
}

/**
 * The river as a map definition over its backing campaign map: the river's
 * level, biome and start; the backing map's id and campaign links stripped
 * (a user river has no continuation and unlocks nothing).
 */
export function userRiverMapDefinition(river: UserRiver, backing: MapRegistryId): MapDefinition {
  const base = getMapDefinition(backing);
  return {
    id: base.id,
    label: river.label,
    levelData: river.level,
    fallbackProgression: base.fallbackProgression,
    startIndex: 0,
    initialBiome: normalizeBiomeId(river.level.world?.biome?.baseType ?? base.initialBiome),
    difficulty: base.difficulty,
    menuHidden: true,
  };
}
