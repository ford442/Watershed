/**
 * userRiverImport — `.wsriver` in, a validated river out (lazy chunk).
 *
 * The StartMenu's "Load river…" and the editor's "Play" import this on demand:
 * it carries the level validator (ajv-compiled schema), which must never ride
 * the entry chunk (`build-budget.json`). A `.wsriver` is exactly the level JSON
 * the editor exports — no new format — and is checked by the same
 * `assertLevelData` the bundled maps' contract test uses.
 */

import { listUserLevels, loadUserLevel, parseAndValidateUserLevel, saveUserLevel } from './userLevelStore';
import { createUserRiver, type UserRiver } from './userRiverSession';

/** A river file is a few hundred kB at most; anything larger is not one. */
export const MAX_RIVER_BYTES = 2 * 1024 * 1024;

/** File extensions the picker offers (`.json` too: the editor's download). */
export const RIVER_FILE_ACCEPT = '.wsriver,.json,application/json';

/** `My Canyon.wsriver` → `my-canyon` (the saved-level id). */
export function riverIdFromName(name: string): string {
  const base = name.replace(/\.(wsriver|json)$/i, '').trim().toLowerCase();
  const slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'river';
}

/**
 * Parse and validate river text. Throws an Error whose message is fit for the
 * menu: not JSON, too large, or the validator's list of what is wrong.
 */
export function parseRiverText(text: string, name = 'river'): UserRiver {
  if (text.length > MAX_RIVER_BYTES) {
    throw new Error(`That file is ${(text.length / 1024 / 1024).toFixed(1)} MB — a river is under 2 MB.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That is not a river file (not JSON). Export one from the level editor.');
  }
  const id = riverIdFromName(name);
  const level = parseAndValidateUserLevel(raw, id);
  if (!Array.isArray(level.segments) || level.segments.length === 0) {
    throw new Error('That river has no segments.');
  }
  return createUserRiver(id, level);
}

/** Read a picked / dropped file as a river. */
export async function importRiverFile(file: File): Promise<UserRiver> {
  if (file.size > MAX_RIVER_BYTES) {
    throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — a river is under 2 MB.`);
  }
  return parseRiverText(await file.text(), file.name);
}

/** Keep an imported river in the saved list (localStorage) so it is there next visit. */
export function rememberRiver(river: UserRiver): void {
  try {
    saveUserLevel(river.id, river.level);
  } catch {
    // Storage full or blocked: the river still plays this session.
  }
}

/**
 * Saved rivers (editor saves and imports), newest first, as playable rivers.
 * Storage is the player's to edit, so each is validated again; a stale or
 * hand-broken entry is left out rather than played.
 */
export function listSavedRivers(): UserRiver[] {
  const rivers: UserRiver[] = [];
  for (const entry of listUserLevels().slice().sort((a, b) => b.savedAt - a.savedAt)) {
    try {
      rivers.push(createUserRiver(entry.id, parseAndValidateUserLevel(entry.level, entry.id)));
    } catch {
      // skip: no longer a valid level
    }
  }
  return rivers;
}

/** One saved river by id (the editor's "Play" hands over its slug), validated. */
export function loadSavedRiver(id: string): UserRiver | null {
  const entry = loadUserLevel(id);
  if (!entry) return null;
  try {
    return createUserRiver(entry.id, parseAndValidateUserLevel(entry.level, entry.id));
  } catch {
    return null;
  }
}
