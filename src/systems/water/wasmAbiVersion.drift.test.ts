/**
 * The loader requires `ws_getVersion() === WASM_ABI_VERSION` (#533), so the TS
 * number and the C++ one must be the same number. This reads
 * `WATERSHED_ABI_VERSION` out of emscripten/bindings.cpp (the way
 * sweConstants.drift.test.ts reads the hydro constants) and fails when one
 * moved without the other — on every `pnpm test`, without a rebuild.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WASM_ABI, WASM_ABI_VERSION, WS_OK, WS_REJECTED } from './wasmAbi';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const bindings = readFileSync(resolve(root, 'emscripten/bindings.cpp'), 'utf8');
const commonH = readFileSync(resolve(root, 'emscripten/common.h'), 'utf8');
const wasmMd = readFileSync(resolve(root, 'WASM.md'), 'utf8');

describe('WASM ABI version drift (#533)', () => {
  it('WASM_ABI_VERSION equals bindings.cpp WATERSHED_ABI_VERSION', () => {
    const match = /WATERSHED_ABI_VERSION = (\d+)/.exec(bindings);
    expect(match, 'bindings.cpp: no WATERSHED_ABI_VERSION (renamed? update this test)').not.toBeNull();
    expect(WASM_ABI_VERSION).toBe(Number(match![1]));
  });

  it('every WASM_ABI entry is a ws_ export in bindings.cpp, and nothing else is', () => {
    const exported = [...bindings.matchAll(/^WS_EXPORT [\w:]+ ws_(\w+)\(/gm)]
      .map((m) => m[1])
      .filter((name) => name !== 'trapTest');
    expect(exported.sort()).toEqual(Object.keys(WASM_ABI).sort());
  });

  it('WS_OK / WS_REJECTED match common.h', () => {
    expect(Number(/WS_OK = (\d+);/.exec(commonH)?.[1])).toBe(WS_OK);
    expect(Number(/WS_REJECTED = (\d+);/.exec(commonH)?.[1])).toBe(WS_REJECTED);
  });

  it('WASM.md states one required version, and it is this one', () => {
    const stated = [...wasmMd.matchAll(/`WASM_ABI_VERSION`[^.\n]*?\*\*(\d+)\*\*/g)].map((m) => Number(m[1]));
    expect(stated.length).toBeGreaterThan(0);
    expect(new Set(stated)).toEqual(new Set([WASM_ABI_VERSION]));
    // The floor is gone: no live statement of one may remain.
    expect(wasmMd).not.toMatch(/MIN_WASM_ABI_VERSION`?\s*(?:is|=|\()\s*\*?\*?\d/);
  });
});
