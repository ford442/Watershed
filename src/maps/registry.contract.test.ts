/**
 * Registry contract test — runtime half of the map registry drift guard.
 *
 * The compile-time half lives in `registry.contract.ts` (test files are
 * excluded from `tsconfig.typecheck.json`, so type-level assertions only bite
 * when they sit in a non-test module). This file covers what `tsc` cannot see:
 * actual `Object.keys` membership, menu metadata presence, resolver
 * round-tripping, and authored-JSON shape drift.
 */

import { describe, expect, it } from 'vitest';
import {
  MAP_REGISTRY,
  mapRegistryIds,
  resolveMapRegistryId,
  isMapRegistryId,
  type MapRegistryId,
} from './registry';
import { listMapsForMenu } from './campaign';
import {
  CANONICAL_MAP_REGISTRY_IDS,
  assertMapRegistryId,
  menuMetadataViolation,
  registeredLevelDataEntries,
} from './registry.contract';
import { validateLevel } from '../utils/levelValidator';
import {
  KNOWN_LEVEL_SCHEMA_DEBT,
  levelErrorSignature,
} from './levelSchemaDebt';

describe('map registry contract — (a) keys are assignable to MapRegistryId', () => {
  it('every Object.keys(MAP_REGISTRY) entry is a MapRegistryId at runtime', () => {
    const keys = Object.keys(MAP_REGISTRY);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(isMapRegistryId(key), `key "${key}" must be a MapRegistryId`).toBe(true);
    }
  });

  it('runtime keys match the canonical id list exactly (both directions)', () => {
    // CANONICAL_MAP_REGISTRY_IDS is pinned to MapRegistryId and to
    // keyof MAP_REGISTRY at tsc time in registry.contract.ts; this asserts the
    // runtime object agrees with that compile-time contract.
    expect([...Object.keys(MAP_REGISTRY)].sort()).toEqual([...CANONICAL_MAP_REGISTRY_IDS].sort());
  });

  it('mapRegistryIds() stays in lockstep with Object.keys order', () => {
    expect(mapRegistryIds()).toEqual(Object.keys(MAP_REGISTRY));
  });

  it('each canonical id passes the typed assertMapRegistryId helper', () => {
    // assertMapRegistryId only accepts MapRegistryId, so this call site is
    // itself a (compile-time) assignability check over the canonical list.
    for (const id of CANONICAL_MAP_REGISTRY_IDS) {
      expect(assertMapRegistryId(id)).toBe(id);
      expect(MAP_REGISTRY[id], `MAP_REGISTRY is missing "${id}"`).toBeDefined();
      expect(MAP_REGISTRY[id].id).toBe(id);
    }
  });
});

describe('map registry contract — (b) menu metadata completeness', () => {
  it('every registry entry has difficulty + estimatedDurationSec, or menuHidden', () => {
    for (const id of mapRegistryIds()) {
      const violation = menuMetadataViolation(MAP_REGISTRY[id]);
      expect(violation, `${id}: ${violation ?? ''}`).toBeNull();
    }
  });

  it('every listMapsForMenu() entry carries both difficulty and estimatedDurationSec', () => {
    const entries = listMapsForMenu();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.difficulty, `${entry.id}.difficulty`).toBeTruthy();
      expect(typeof entry.estimatedDurationSec, `${entry.id}.estimatedDurationSec`).toBe('number');
      expect(entry.estimatedDurationSec, `${entry.id}.estimatedDurationSec > 0`).toBeGreaterThan(0);
    }
  });

  it('menu list is exactly the non-menuHidden registry entries, in registry order', () => {
    const expected = mapRegistryIds().filter((id) => !MAP_REGISTRY[id].menuHidden);
    expect(listMapsForMenu().map((entry) => entry.id)).toEqual(expected);
  });

  it('menuHidden maps stay deep-linkable even though they are off the menu', () => {
    const hidden = mapRegistryIds().filter((id) => MAP_REGISTRY[id].menuHidden);
    for (const id of hidden) {
      expect(listMapsForMenu().map((entry) => entry.id)).not.toContain(id);
      expect(resolveMapRegistryId(id)).toBe(id);
    }
  });
});

describe('map registry contract — (c) resolveMapRegistryId round-trips', () => {
  it('round-trips every registered id', () => {
    for (const id of mapRegistryIds()) {
      expect(resolveMapRegistryId(id), `resolveMapRegistryId("${id}")`).toBe(id);
    }
  });

  it('round-trips every registered id through case / whitespace normalisation', () => {
    for (const id of mapRegistryIds()) {
      expect(resolveMapRegistryId(`  ${id.toUpperCase()}  `)).toBe(id);
    }
  });

  it('rejects unknown tokens instead of falling back to a real map', () => {
    for (const raw of ['', '   ', 'not-a-map', 'meanderr', null, undefined]) {
      expect(resolveMapRegistryId(raw)).toBeNull();
    }
  });

  it('every alias resolves to a registered id', () => {
    const aliases: Record<string, MapRegistryId> = {
      lumberflume: 'lumber',
      flume: 'lumber',
      glacier: 'glacial',
      hydrodam: 'hydro',
      dam: 'hydro',
    };
    for (const [alias, expected] of Object.entries(aliases)) {
      expect(resolveMapRegistryId(alias)).toBe(expected);
      expect(isMapRegistryId(expected)).toBe(true);
    }
  });
});

/**
 * Authored JSON shape drift.
 *
 * Registered map JSONs satisfy `level.schema.json` (optional `decorations`,
 * negative pre-roll indices down to -10). `levelValidator` excludes pre-roll
 * segments from `totalSegments` count checks. Registry load uses
 * `assertLevelData()` — keep `KNOWN_LEVEL_SCHEMA_DEBT` empty unless documenting
 * a deliberate temporary exception.
 */
describe('map registry contract — authored JSON shape drift (ajv)', () => {
  const entries = registeredLevelDataEntries();

  it('covers every registered levelData, including continuations', () => {
    expect(entries.length).toBeGreaterThanOrEqual(mapRegistryIds().length);
  });

  it.each(entries.map((entry) => [entry.label, entry.levelData] as const))(
    '%s introduces no schema violations outside the documented debt list',
    (label, levelData) => {
      const result = validateLevel(levelData);
      const unexpected = result.errors
        .map((err) => levelErrorSignature(err.field, err.error))
        .filter((signature) => !KNOWN_LEVEL_SCHEMA_DEBT.includes(signature));
      expect(
        [...new Set(unexpected)],
        `${label} has new schema violations — fix the JSON or extend KNOWN_SCHEMA_DEBT deliberately`,
      ).toEqual([]);
    },
  );

  it.each(entries.map((entry) => [entry.label, entry.levelData] as const))(
    '%s satisfies the LevelData invariants MapSystem reads at runtime',
    (label, levelData) => {
      const data = levelData as Record<string, any>;

      expect(data.metadata?.name, `${label}.metadata.name`).toBeTruthy();
      expect(typeof data.metadata?.version, `${label}.metadata.version`).toBe('string');

      const track = data.world?.track;
      expect(Array.isArray(track?.waypoints), `${label}.world.track.waypoints`).toBe(true);
      expect(track.waypoints.length, `${label} needs >= 4 waypoints`).toBeGreaterThanOrEqual(4);
      for (const point of track.waypoints) {
        expect(point, `${label} waypoint must be [x, y, z]`).toHaveLength(3);
        for (const axis of point) expect(Number.isFinite(axis)).toBe(true);
      }
      expect(typeof track.segmentLength, `${label}.world.track.segmentLength`).toBe('number');
      expect(typeof data.world?.biome?.baseType, `${label}.world.biome.baseType`).toBe('string');

      expect(Array.isArray(data.segments), `${label}.segments`).toBe(true);
      expect(data.segments.length, `${label}.segments`).toBeGreaterThan(0);
      const indices = data.segments.map((seg: any) => seg.index);
      expect(new Set(indices).size, `${label} has duplicate segment indices`).toBe(indices.length);
      for (const seg of data.segments) {
        expect(Number.isInteger(seg.index), `${label} segment index must be an integer`).toBe(true);
        expect(typeof seg.difficulty, `${label} segment ${seg.index}.difficulty`).toBe('number');
      }

      const start = data.spawns?.start?.position;
      expect(Array.isArray(start), `${label}.spawns.start.position`).toBe(true);
      expect(start).toHaveLength(3);
      for (const axis of start) expect(Number.isFinite(axis)).toBe(true);
    },
  );
});
