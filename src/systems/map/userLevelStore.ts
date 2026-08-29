/**
 * userLevelStore — workshop-scale user drainage (#391 Phase C).
 *
 * Drop JSON in public/levels/ (same-origin fetch) or persist via localStorage.
 * Not Steam Workshop. No accounts. Validates with assertLevelData / ajv.
 */

import { assertLevelData } from '../../maps/assertLevelData';
import type { LevelData } from './MapSystem';

export const USER_LEVEL_STORAGE_KEY = 'watershed.userLevels';

export interface StoredUserLevel {
  id: string;
  savedAt: number;
  level: LevelData;
}

function readAll(): StoredUserLevel[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(USER_LEVEL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === 'object' && typeof (item as StoredUserLevel).id === 'string');
  } catch {
    return [];
  }
}

function writeAll(entries: StoredUserLevel[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(USER_LEVEL_STORAGE_KEY, JSON.stringify(entries));
}

export function parseAndValidateUserLevel(raw: unknown, label = 'user-level'): LevelData {
  return assertLevelData(raw, label);
}

export function saveUserLevel(id: string, raw: unknown): StoredUserLevel {
  const level = parseAndValidateUserLevel(raw, id);
  const entry: StoredUserLevel = { id, savedAt: Date.now(), level };
  const next = readAll().filter((item) => item.id !== id);
  next.push(entry);
  writeAll(next);
  return entry;
}

export function loadUserLevel(id: string): StoredUserLevel | null {
  return readAll().find((item) => item.id === id) ?? null;
}

export function listUserLevels(): StoredUserLevel[] {
  return readAll();
}

export function clearUserLevelsForTests(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(USER_LEVEL_STORAGE_KEY);
}
