/**
 * The hand-written persistence guard must accept and reject exactly what
 * formats/persistence.schema.json does (#485 C). Ajv is a devDependency, so this test is
 * the only place it still runs: every leaf of a full payload is mutated several ways and
 * both validators must agree on every mutant.
 */
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import persistenceSchema from '../../formats/persistence.schema.json';
import { isPersistencePayload } from './PersistenceSystem';

const ajv = new Ajv({ allErrors: true, strict: false });
const schemaValidate = ajv.compile(persistenceSchema);

const FULL = {
  version: 1,
  settings: { quality: 'high', soundVolume: 0.5 },
  vehicleType: 'raft',
  ghostEnabled: true,
  lastMapId: 'meander',
  completedMaps: ['glacial', 'lumber'],
  launchHour: 14,
  launchWeather: 'rain',
  runs: {
    'meander:1': {
      bestScore: 10,
      bestAirTime: 1.5,
      bestTimeMs: 61000,
      ghostData: 'abc',
      splits: [{ segmentIndex: 1, tMs: 1000, speed: 12 }],
      launchHour: 6,
      hydroEventHash: 'deadbeef',
    },
  },
  rivals: {
    meander: {
      codecVersion: 2,
      mapId: 'meander',
      timeMs: 59000,
      ghostData: 'xyz',
      exportedAt: 1_700_000_000_000,
      splits: [{ segmentIndex: 2, tMs: 2000, speed: 9 }],
      launchHour: 23,
      hydroEventHash: 'cafe',
      qualityPreset: 'ultra',
    },
  },
};

const clone = <T,>(v: T): T => structuredClone(v);

/** Every [path-to-parent, key] in the document, containers and leaves alike. */
function paths(node: unknown, trail: (string | number)[] = [], out: (string | number)[][] = []) {
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const here = [...trail, Array.isArray(node) ? Number(k) : k];
      out.push(here);
      paths(v, here, out);
    }
  }
  return out;
}
function setAt(doc: any, path: (string | number)[], value: unknown) {
  let cursor = doc;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path[path.length - 1]] = value;
}
function deleteAt(doc: any, path: (string | number)[]) {
  let cursor = doc;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  delete cursor[path[path.length - 1]];
}
function parentAt(doc: any, path: (string | number)[]) {
  let cursor = doc;
  for (const key of path) cursor = cursor[key];
  return cursor;
}

const VALUES: unknown[] = [
  null, undefined, true, false, 0, 1, -1, 0.5, 1.5, 2, 23, 24, 1e9, NaN, Infinity, -Infinity,
  '', 'x', 'low', 'ultra', 'rain', 'runner', 'raft', 'a'.repeat(32), 'a'.repeat(33), '😀'.repeat(32), '😀'.repeat(33),
  [], [1], ['a'], ['a', 'a'], {}, { a: 1 }, 'constructor',
];

describe('isPersistencePayload mirrors persistence.schema.json', () => {
  it('agrees on the full payload and a minimal one', () => {
    expect(isPersistencePayload(FULL)).toBe(true);
    expect(schemaValidate(FULL)).toBe(true);
    const minimal = {
      version: 1,
      settings: { quality: 'low', soundVolume: 0 },
      vehicleType: 'runner',
      ghostEnabled: false,
      runs: {},
    };
    expect(isPersistencePayload(minimal)).toBe(true);
    expect(schemaValidate(minimal)).toBe(true);
  });

  it('agrees on non-objects', () => {
    for (const v of [null, undefined, 0, 1, '', 'x', true, [], [FULL], NaN]) {
      expect(isPersistencePayload(v), String(v)).toBe(schemaValidate(v));
    }
  });

  it('agrees on every mutation of every field (replace, delete, extra key, undefined)', () => {
    let compared = 0;
    let rejected = 0;
    for (const path of paths(FULL)) {
      for (const value of VALUES) {
        const doc = clone(FULL);
        setAt(doc, path, value);
        const a = isPersistencePayload(doc);
        expect(a, `${path.join('.')} = ${String(value)}`).toBe(schemaValidate(doc));
        compared += 1;
        if (!a) rejected += 1;
      }
      const deleted = clone(FULL);
      deleteAt(deleted, path);
      expect(isPersistencePayload(deleted), `delete ${path.join('.')}`).toBe(schemaValidate(deleted));

      // An unknown key beside this one (object parents only), plain and set to undefined.
      const container = parentAt(clone(FULL), path.slice(0, -1));
      if (container !== null && typeof container === 'object' && !Array.isArray(container)) {
        for (const extra of ['bogus', 'constructor', '__proto__x']) {
          for (const v of [1, undefined]) {
            const doc = clone(FULL);
            parentAt(doc, path.slice(0, -1))[extra] = v;
            expect(isPersistencePayload(doc), `extra ${extra} at ${path.join('.')}`).toBe(schemaValidate(doc));
          }
        }
      }
      compared += 1;
    }
    // The corpus must really exercise both outcomes, or the equivalence proves nothing.
    expect(compared).toBeGreaterThan(500);
    expect(rejected).toBeGreaterThan(100);
  });

  it('agrees on a __proto__ own key (JSON.parse creates one)', () => {
    const doc = JSON.parse(JSON.stringify(FULL).replace('"runs":{', '"runs":{"__proto__":{"bestScore":1,"bestAirTime":1},'));
    expect(isPersistencePayload(doc)).toBe(schemaValidate(doc));
    const bad = JSON.parse(JSON.stringify(FULL).replace('"runs":{', '"runs":{"__proto__":{"bestScore":-1,"bestAirTime":1},'));
    expect(isPersistencePayload(bad)).toBe(schemaValidate(bad));
    expect(isPersistencePayload(bad)).toBe(false);
  });
});
