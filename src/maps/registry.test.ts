/**
 * Registry drift guard — catches the MapRegistryId / MAP_REGISTRY / menu
 * metadata mismatch class that left `tsc` red on main (#300).
 */

import { describe, expect, it } from 'vitest';
import { isMapRegistryId, listMapsForMenu } from './campaign';
import {
  MAP_REGISTRY,
  mapRegistryIds,
  resolveMapRegistryId,
  type MapRegistryId,
} from './registry';

describe('map registry drift guard', () => {
  it('every Object.keys(MAP_REGISTRY) value is a valid MapRegistryId', () => {
    const keys = Object.keys(MAP_REGISTRY);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(isMapRegistryId(key), `key "${key}" must be a MapRegistryId`).toBe(true);
    }
    // mapRegistryIds stays in lockstep with Object.keys
    expect(mapRegistryIds()).toEqual(keys);
  });

  it('every non-menuHidden registry entry has difficulty + estimatedDurationSec', () => {
    for (const id of mapRegistryIds()) {
      const def = MAP_REGISTRY[id];
      if (def.menuHidden) continue;
      expect(def.difficulty, `${id}.difficulty`).toBeTruthy();
      expect(typeof def.estimatedDurationSec, `${id}.estimatedDurationSec`).toBe('number');
      expect(def.estimatedDurationSec! > 0, `${id}.estimatedDurationSec > 0`).toBe(true);
    }
  });

  it('resolveMapRegistryId round-trips every registry id', () => {
    for (const id of mapRegistryIds()) {
      expect(resolveMapRegistryId(id)).toBe(id);
    }
  });

  it('menu list excludes menuHidden maps but keeps campaign chain metadata', () => {
    const menuIds = listMapsForMenu().map((m) => m.id);
    expect(menuIds).toEqual(['glacial', 'meander', 'delta']);
    expect(menuIds).not.toContain('lumber' satisfies MapRegistryId);
  });
});
