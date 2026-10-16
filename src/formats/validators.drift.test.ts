/**
 * The checked-in precompiled validators (#485 C) must be (a) exactly what
 * scripts/compile-validators.mjs produces from the schema as it is now, and (b) behave
 * like the runtime Ajv they replaced: same verdict, same errors, and the `value` that
 * callers used to read from `err.data` recovered from `instancePath`.
 *
 * Ajv is a devDependency; this file and compile-validators.mjs are the only users left.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { generateValidator, outputPaths, schemaPath, VALIDATORS } from '../../scripts/compile-validators.mjs';
import levelPrecompiled from './level.validate.js';
import reachPrecompiled from './reach.validate.js';
import { valueAtPointer } from './valueAtPointer';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

const reachFixture = () => ({
  reachId: 'test-reach',
  metadata: { name: 'Test Reach', author: 'Test Author', difficulty: 'beginner', estimatedDuration: 120, version: '1.0.0' },
  world: {
    track: {
      waypoints: [[0, 0, 0], [0, -5, -30], [10, -10, -80], [-5, -15, -140]],
      segmentLength: 30,
      totalSegments: 3,
    },
    biome: {
      baseType: 'canyonSummer',
      sky: { color: '#87CEEB' },
      fog: { color: '#D4E9F7', near: 50, far: 200 },
      lighting: { sunIntensity: 1.4, sunAngle: 45 },
      water: { tint: '#1a6b8a', flowSpeed: 1.0 },
    },
  },
  segments: [
    { index: 0, difficulty: 0.3, decorations: { trees: 10 } },
    { index: 1, difficulty: 0.4, decorations: { trees: 12 } },
    { index: 2, difficulty: 0.5, decorations: { trees: 8 } },
  ],
  spawns: { start: { position: [0, -4, 5] } },
  requiredAssets: { textures: [], models: [], audio: [], shaders: [] },
  transition: { segmentIndex: 2, type: 'waterfall', durationSeconds: 5 },
});

const levelDocs: Record<string, unknown> = {};
for (const dir of ['../maps', '../../public/levels']) {
  const abs = path.resolve(here, dir);
  for (const f of fs.readdirSync(abs).filter((n) => n.endsWith('.json'))) {
    levelDocs[`${path.basename(dir)}/${f}`] = readJson(path.join(abs, f));
  }
}

const SUBJECTS = {
  level: { precompiled: levelPrecompiled, docs: levelDocs },
  reach: { precompiled: reachPrecompiled, docs: { fixture: reachFixture() } as Record<string, unknown> },
} as const;

const MUTANTS: unknown[] = [
  null, undefined, true, 0, -1, 1.5, 1e9, NaN, '', 'x', '#xyz', '1.2', 'canyonSummer', [], [1, 2], ['a'], {}, { a: 1 },
  'a'.repeat(51), '😀'.repeat(50), '😀'.repeat(51),
];

function leafPaths(node: unknown, trail: (string | number)[] = [], out: (string | number)[][] = []) {
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const here2 = [...trail, Array.isArray(node) ? Number(k) : k];
      out.push(here2);
      leafPaths(v, here2, out);
    }
  }
  return out;
}
function setAt(doc: any, p: (string | number)[], value: unknown) {
  let cursor = doc;
  for (const key of p.slice(0, -1)) cursor = cursor[key];
  cursor[p[p.length - 1]] = value;
}

/** Every error field the app can read. `schemaPath` is blanked in the generated code (it is
 *  asserted to be "" below) so it is the one field not compared. */
const normalise = (errors: any[] | null | undefined) =>
  (errors ?? []).map((e) => ({
    instancePath: e.instancePath,
    keyword: e.keyword,
    params: e.params,
    message: e.message,
  }));

describe.each(VALIDATORS)('%s validator', (name) => {
  const subject = SUBJECTS[name as keyof typeof SUBJECTS];
  const schema = readJson(schemaPath(name));
  // What the runtime used to build in every player's browser.
  const reference = new Ajv({ allErrors: true, verbose: true }).compile(schema);

  it('checked-in output is what compile-validators.mjs generates from the schema today', () => {
    const { js, dts } = generateValidator(name);
    const out = outputPaths(name);
    expect(fs.readFileSync(out.js, 'utf8') === js, `${name}.validate.js is stale — run \`pnpm compile:validators\``).toBe(true);
    expect(fs.readFileSync(out.dts, 'utf8') === dts, `${name}.validate.d.ts is stale — run \`pnpm compile:validators\``).toBe(true);
  });

  it('has no import, require or ajv reference (self-contained)', () => {
    const text = fs.readFileSync(outputPaths(name).js, 'utf8');
    expect(text).not.toMatch(/\brequire\(/);
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/from\s+["']ajv/);
  });

  function agree(doc: unknown, label: string) {
    const expected = reference(doc);
    const actual = subject.precompiled(doc);
    expect(actual, `${label}: verdict`).toBe(expected);
    expect(normalise(subject.precompiled.errors), `${label}: errors`).toEqual(normalise(reference.errors));
    for (const err of subject.precompiled.errors ?? []) expect(err.schemaPath, `${label}: schemaPath`).toBe('');
    for (const [i, err] of (reference.errors ?? []).entries()) {
      expect(valueAtPointer(doc, err.instancePath), `${label}: err[${i}].data`).toEqual(err.data);
    }
    return expected;
  }

  it('agrees with a verbose Ajv on the authored documents', () => {
    for (const [label, doc] of Object.entries(subject.docs)) agree(doc, label);
  });

  it('agrees on mutations of every field (verdict, errors, recovered value)', () => {
    let compared = 0;
    let invalid = 0;
    for (const [label, doc] of Object.entries(subject.docs)) {
      const all = leafPaths(doc);
      const stride = Math.max(1, Math.ceil(all.length / 60));
      for (let i = 0; i < all.length; i += stride) {
        for (const value of MUTANTS) {
          const mutant = structuredClone(doc);
          setAt(mutant, all[i], value);
          if (!agree(mutant, `${label} ${all[i].join('.')} = ${String(value)}`)) invalid += 1;
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(400);
    expect(invalid).toBeGreaterThan(40);
  }, 60_000);
});
