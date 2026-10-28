// @vitest-environment node
/**
 * wasmTrap.test.ts — a watershed_native trap names its function (#502 B).
 *
 * The parser is checked against the stack shapes V8 and SpiderMonkey print
 * for a release binary (index only) and a Debug one (name section), the
 * committed symbol map against the committed binary's exports, and — when a
 * Debug pair has been built (`pnpm build:wasm:debug`) — the whole
 * `?wasmTrapTest=1` path against a binary that really traps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { failedStatus } from '../../sim/nativeOwner';
import { wasmExportName, type RawWatershedModule, type WasmAbiFunctionName } from './wasmAbi';
import { WASM_BINARY_SHA } from './wasmArtifactStamp';
import { __setGlueImporterForTests, loadWatershedNative } from './wasmLoader';
import {
  describeWasmTrap,
  innermostWasmFrame,
  parseWasmSymbolMap,
  WasmTrapError,
} from './wasmTrap';
import { trapFunctionOf, wantsWasmTrapTest } from './wasmTrapMarker';

const root = resolve(__dirname, '../../..');
const debugDir = resolve(root, 'emscripten/build-debug/out');
const hasDebugPair = existsSync(resolve(debugDir, 'watershed_native.wasm'));

function trap(stack: string): Error {
  const error = new WebAssembly.RuntimeError('unreachable');
  Object.defineProperty(error, 'stack', { value: stack });
  return error;
}

afterEach(() => {
  __setGlueImporterForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('stack parsing', () => {
  const symbols = parseWasmSymbolMap('0:abort\n37:ws_stepShallowWater\nnot a line\n40:ws_routeReach\n');

  it('maps a release (index-only) V8 frame through the symbol map', () => {
    const error = trap('RuntimeError: unreachable\n    at wasm://wasm/0031c886:wasm-function[37]:0x1a2b\n    at Object.step (x.js:1:1)');
    expect(describeWasmTrap(error, symbols)).toBe('ws_stepShallowWater');
    expect(describeWasmTrap(error)).toBe('wasm-function[37]');
  });

  it('reads a Debug build’s own names (V8 and SpiderMonkey)', () => {
    expect(innermostWasmFrame('    at watershed_native.wasm.ws_trapTest (wasm://wasm/x:wasm-function[50]:0x3250)'))
      .toEqual({ index: 50, name: 'ws_trapTest' });
    expect(innermostWasmFrame('ws_trapTest@http://x/watershed_native.wasm:wasm-function[50]:0x3250\n'))
      .toEqual({ index: 50, name: 'ws_trapTest' });
    expect(innermostWasmFrame('@http://x/watershed_native.wasm:wasm-function[51]:0x10')).toEqual({ index: 51, name: null });
    // Source-mapped (Node / vitest): the index is rewritten to a byte offset.
    expect(innermostWasmFrame('RuntimeError: unreachable\n    at ws_trapTest (wasm://wasm/watershed_native.wasm-0031c886:1:12881)\n    at f (a.js:1:1)'))
      .toEqual({ index: null, name: 'ws_trapTest' });
  });

  it('is not fooled by JS frames or non-traps', () => {
    expect(describeWasmTrap(new Error('plain'), symbols)).toBeNull();
    expect(describeWasmTrap(trap('RuntimeError: x\n    at foo (bar.js:1:1)'), symbols)).toBeNull();
  });

  it('survives a worker hop: the HUD status reads the function back out of the message', () => {
    const named = new WasmTrapError('ws_routeReach', new Error('unreachable'));
    expect(trapFunctionOf(named)).toBe('ws_routeReach');
    const hopped = new Error(`watershed_native failed to load in the sim worker: ${named.message}`);
    expect(failedStatus(hopped)).toMatchObject({ status: 'failed', trapFunction: 'ws_routeReach' });
    expect(failedStatus(new Error('glue 404'))).not.toHaveProperty('trapFunction');
  });

  it('?wasmTrapTest=1 is opt-in', () => {
    expect(wantsWasmTrapTest('?wasmTrapTest=1')).toBe(true);
    expect(wantsWasmTrapTest('?wasmTrapTest=0')).toBe(false);
    expect(wantsWasmTrapTest('')).toBe(false);
  });
});

describe('committed symbol map', () => {
  it('names the committed binary’s exports', () => {
    const map = parseWasmSymbolMap(readFileSync(resolve(root, 'emscripten/watershed_native.symbols'), 'utf8'));
    const names = new Set(map.values());
    // -flto folds identical bodies (ws_freeParticleSoA is ws_freeGrid's free),
    // so not every export keeps its own index — but the kernels do.
    for (const name of ['getVersion', 'stepShallowWater', 'applySWEEvent', 'scrollShallowWater', 'routeReach',
      'reduceF32Grid', 'blurSeparableF32', 'stepSplashParticles'] as WasmAbiFunctionName[]) {
      expect(names.has(wasmExportName(name).slice(1)), name).toBe(true);
    }
    // The shipped binary has no trap hook.
    expect(names.has('ws_trapTest')).toBe(false);
  });
});

const describeDebug = hasDebugPair ? describe : describe.skip;

describeDebug('?wasmTrapTest=1 against the Debug build (pnpm build:wasm:debug)', () => {
  it('rejects the load with the function the trap happened in', async () => {
    const glue = await import(/* @vite-ignore */ pathToFileURL(resolve(debugDir, 'watershed_native.js')).href);
    const raw = (await glue.default({
      wasmBinary: new Uint8Array(readFileSync(resolve(debugDir, 'watershed_native.wasm'))),
    })) as RawWatershedModule;
    expect(typeof raw._ws_trapTest).toBe('function');

    // The Debug pair is not the stamped one, so hand the loader the committed
    // bytes to verify and the Debug module to bind.
    __setGlueImporterForTests(async () => ({ default: async () => raw, WATERSHED_WASM_SHA: WASM_BINARY_SHA }));
    const committed = new Uint8Array(readFileSync(resolve(root, 'public/watershed_native.wasm')));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      url.includes('.symbols')
        ? { ok: false, status: 404, text: async () => '' }
        : { ok: true, status: 200, arrayBuffer: async () => committed.slice().buffer }
    )));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const err = await loadWatershedNative(
      { glue: 'https://example.test/watershed_native.js', wasm: 'https://example.test/watershed_native.wasm' },
      10_000,
      { trapTest: true },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WasmTrapError);
    expect((err as WasmTrapError).trapFunction).toBe('ws_trapTest');
    expect(failedStatus(err)).toMatchObject({ trapFunction: 'ws_trapTest' });
  });
});
