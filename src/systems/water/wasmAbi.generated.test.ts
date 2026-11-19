/**
 * One ABI source (#575). Before this, the export table was typed by hand in
 * five places (bindings.cpp, the WASM_ABI arity table, the TS interface, the
 * headers, WASM.md) and a test compared the version numbers and arities. Now
 * emscripten/abi.def is the one declaration and scripts/gen-abi.mjs writes the
 * rest; this runs its --check on every `pnpm test` (it also runs in
 * `pnpm typecheck` and in every CMake build), and pins what the check is for.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkAbi, checkImplementations, parseDef } from '../../../scripts/gen-abi.mjs';
import { WASM_ABI, WASM_ABI_VERSION } from './wasmAbi';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const def = readFileSync(resolve(root, 'emscripten/abi.def'), 'utf8');
const wasmMd = readFileSync(resolve(root, 'WASM.md'), 'utf8');

describe('watershed_native ABI: abi.def is the one source (#575)', () => {
  it('gen-abi --check: the headers and every generated file agree with abi.def', () => {
    expect(checkAbi()).toEqual([]);
  });

  it('the table has every abi.def export and nothing else', () => {
    expect(Object.keys(WASM_ABI).sort()).toEqual(parseDef(def).fns.map((f) => f.name).sort());
    expect(WASM_ABI_VERSION).toBe(parseDef(def).version);
  });

  it('a same-type parameter swap in a header is reported by name', () => {
    const model = parseDef(def);
    const swapped = (h: string) => {
      const text = readFileSync(resolve(root, 'emscripten', h), 'utf8');
      return h === 'routing.h' ? text.replace('float inflowQ, float dt, uintptr_t storagePtr', 'float dt, float inflowQ, uintptr_t storagePtr') : text;
    };
    const problems = checkImplementations(model, swapped);
    expect(problems.join('\n')).toMatch(/routing\.h: routeReach\(.*float dt, float inflowQ/);
  });

  it('WASM.md states one required version, and it is this one', () => {
    const stated = [...wasmMd.matchAll(/`WASM_ABI_VERSION`[^.\n]*?\*\*(\d+)\*\*/g)].map((m) => Number(m[1]));
    expect(stated.length).toBeGreaterThan(0);
    expect(new Set(stated)).toEqual(new Set([WASM_ABI_VERSION]));
    expect(wasmMd).not.toMatch(/MIN_WASM_ABI_VERSION`?\s*(?:is|=|\()\s*\*?\*?\d/);
  });
});
