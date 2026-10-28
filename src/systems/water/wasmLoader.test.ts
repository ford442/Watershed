/**
 * wasmLoader.test.ts — load once, hash once (#467).
 *
 * The committed public/ pair is real input here: the glue is imported from
 * disk and instantiated on the fetched bytes, so `pnpm test` (no Emscripten,
 * no env flag) proves the loader binds the shipped binary.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  allocateGrids,
  arityMismatches,
  bindNativeModule,
  isWasmHeapExhaustedError,
  MIN_WASM_ABI_VERSION,
  WASM_ABI,
  WasmHeapExhaustedError,
  wasmExportName,
  type RawWatershedModule,
  type WasmAbiFunctionName,
} from './wasmAbi';
import { WASM_ARTIFACT_STAMP, WASM_BINARY_SHA } from './wasmArtifactStamp';
import {
  __resetWasmLoaderForTests,
  __setGlueImporterForTests,
  getWasm,
  isRetryableWasmInitError,
  isWasmProvenanceMismatchError,
  loadWatershedNative,
  loadWatershedNativeWithRetry,
  peekWasm,
  peekWasmInitError,
  resolveWasmInitTimeoutMs,
  sha256Hex16,
  WASM_INIT_TIMEOUT_MS,
  WasmInitTimeoutError,
  type WatershedGlueModule,
} from './wasmLoader';

const publicDir = resolve(__dirname, '../../../public');
const gluePath = resolve(publicDir, 'watershed_native.js');
const glueText = readFileSync(gluePath, 'utf8');
const glueBytes = new Uint8Array(readFileSync(gluePath));
const wasmBytes = new Uint8Array(readFileSync(resolve(publicDir, 'watershed_native.wasm')));

const URLS = {
  glue: 'https://example.test/watershed_native.js?v=x',
  wasm: 'https://example.test/watershed_native.wasm?v=x',
};

const realGlue = (): Promise<WatershedGlueModule> =>
  import(/* @vite-ignore */ pathToFileURL(gluePath).href) as Promise<WatershedGlueModule>;

function stubFetch(body: Uint8Array): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => body.slice().buffer,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function quietConsole(): { error: ReturnType<typeof vi.spyOn> } {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  return { error: vi.spyOn(console, 'error').mockImplementation(() => {}) };
}

afterEach(() => {
  __setGlueImporterForTests(null);
  __resetWasmLoaderForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('committed pair', () => {
  it('the stamp file matches the committed bytes (build.sh hashing)', async () => {
    expect(await sha256Hex16(glueBytes, wasmBytes)).toBe(WASM_ARTIFACT_STAMP);
    expect(await sha256Hex16(wasmBytes)).toBe(WASM_BINARY_SHA);
  });

  it('the glue names the wasm it was linked with', () => {
    expect(glueText).toContain(`export const WATERSHED_WASM_SHA = "${WASM_BINARY_SHA}";`);
  });

  it('the glue has no runtime code generation (CSP script-src without unsafe-eval)', () => {
    expect(glueText).not.toMatch(/\bnew Function\b|\bFunction\(|\beval\(/);
  });

  it('the glue exposes every _ws_* export in WASM_ABI, and nothing else', () => {
    const inGlue = new Set(glueText.match(/_ws_[A-Za-z0-9]+/g));
    const inTable = new Set((Object.keys(WASM_ABI) as WasmAbiFunctionName[]).map(wasmExportName));
    expect([...inGlue].sort()).toEqual([...inTable].sort());
  });
});

describe('loadWatershedNative', () => {
  it('fetches only the wasm, instantiates those bytes, and binds the real module', async () => {
    __setGlueImporterForTests(realGlue);
    const fetchMock = stubFetch(wasmBytes);
    quietConsole();

    const wasm = await loadWatershedNative(URLS, 10_000);

    // One fetch: the wasm. The glue is the import; the factory got wasmBinary
    // and never fetched on its own.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(URLS.wasm);
    expect(wasm.getVersion()).toBeGreaterThanOrEqual(MIN_WASM_ABI_VERSION);
    expect(wasm.routedEdgeState(40, 40, 1, 9.80665)).toEqual({ eta: 0, speed: 0 });
    // A stationary submerged raft in a −Z current is pushed downstream.
    const io = wasm.allocateGrid(16);
    wasm.HEAPF32.set([0, 0.45, -10, 0, 0, 0, 0, -1], io >> 2);
    wasm.computeWaterForcesBatch(io, io + 32, 1, 2, 0.5, 80, 1, 0.47, 1.5, 0.7, 0, 0, 2.4);
    const out = wasm.HEAPF32.subarray((io >> 2) + 8, (io >> 2) + 16);
    expect(out[2]).toBeLessThan(0);
    expect(out[0]).toBe(0);
    wasm.freeGrid(io);
  });

  it('every raw export has the arity the table declares', async () => {
    const glue = await realGlue();
    const raw = await glue.default({ wasmBinary: wasmBytes }) as unknown as Record<string, unknown>;
    for (const name of Object.keys(WASM_ABI) as WasmAbiFunctionName[]) {
      const fn = raw[wasmExportName(name)] as ((...a: number[]) => number) | undefined;
      expect(typeof fn, name).toBe('function');
      expect(fn!.length, name).toBe(WASM_ABI[name].arity);
    }
  });

  it('rejects wasm bytes that do not match WASM_BINARY_SHA, before instantiating', async () => {
    const factory = vi.fn();
    __setGlueImporterForTests(async () => ({ default: factory, WATERSHED_WASM_SHA: WASM_BINARY_SHA }));
    stubFetch(new Uint8Array([1, 2, 3]));
    const { error } = quietConsole();

    await expect(loadWatershedNative(URLS, 10_000)).rejects.toThrow(/stamp mismatch: wasm=/);
    expect(factory).not.toHaveBeenCalled();
    expect(error.mock.calls.some((c) => String(c[0]).includes('provenance-mismatch('))).toBe(true);
  });

  it('rejects a glue linked against a different wasm', async () => {
    const factory = vi.fn();
    __setGlueImporterForTests(async () => ({ default: factory, WATERSHED_WASM_SHA: '0123456789abcdef' }));
    stubFetch(wasmBytes);
    quietConsole();

    const err = await loadWatershedNative(URLS, 10_000).catch((e: unknown) => e);
    expect(isWasmProvenanceMismatchError(err)).toBe(true);
    expect(String(err)).toMatch(/glue built for wasm=0123456789abcdef/);
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects a binary below MIN_WASM_ABI_VERSION', async () => {
    __setGlueImporterForTests(async () => ({
      default: async () => ({ _ws_getVersion: () => 11 }) as never,
      WATERSHED_WASM_SHA: WASM_BINARY_SHA,
    }));
    stubFetch(wasmBytes);
    quietConsole();

    await expect(loadWatershedNative(URLS, 10_000))
      .rejects.toThrow(`ABI 11 is older than required ${MIN_WASM_ABI_VERSION}`);
  });

  it('rejects a binary missing a table export (ABI mismatch, not a crash later)', async () => {
    __setGlueImporterForTests(async () => ({
      default: async () => ({ _ws_getVersion: () => MIN_WASM_ABI_VERSION }) as never,
      WATERSHED_WASM_SHA: WASM_BINARY_SHA,
    }));
    stubFetch(wasmBytes);
    quietConsole();

    await expect(loadWatershedNative(URLS, 10_000)).rejects.toThrow(/ABI mismatch: missing _ws_computeWaterForcesBatch/);
  });

  it('times out with a greppable error when the factory never settles', async () => {
    vi.useFakeTimers();
    __setGlueImporterForTests(async () => ({
      default: () => new Promise(() => { /* hang */ }),
      WATERSHED_WASM_SHA: WASM_BINARY_SHA,
    }));
    stubFetch(wasmBytes);
    const { error } = quietConsole();

    const pending = loadWatershedNative(URLS, 50);
    const settled = expect(pending).rejects.toBeInstanceOf(WasmInitTimeoutError);
    await vi.advanceTimersByTimeAsync(60);
    await settled;
    expect(error).toHaveBeenCalledWith('[Watershed WASM] timed-out(50ms)');
  });
});

describe('deadline and retry (#502 C)', () => {
  it('aborts the losing wasm fetch at the deadline', async () => {
    vi.useFakeTimers();
    __setGlueImporterForTests(async () => ({ default: async () => ({}) as never, WATERSHED_WASM_SHA: WASM_BINARY_SHA }));
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      signal = init?.signal;
      return new Promise(() => { /* the request is lost */ });
    }));
    quietConsole();

    const pending = loadWatershedNative(URLS, 50);
    const settled = expect(pending).rejects.toBeInstanceOf(WasmInitTimeoutError);
    await vi.advanceTimersByTimeAsync(60);
    await settled;
    expect(signal?.aborted).toBe(true);
  });

  it('retries once after a timeout, then binds', async () => {
    vi.useFakeTimers();
    let imports = 0;
    __setGlueImporterForTests(async () => {
      imports += 1;
      if (imports === 1) return new Promise(() => { /* lost */ });
      return realGlue();
    });
    stubFetch(wasmBytes);
    quietConsole();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pending = loadWatershedNativeWithRetry(URLS, 50);
    await vi.advanceTimersByTimeAsync(60);
    vi.useRealTimers();
    const wasm = await pending;
    expect(imports).toBe(2);
    expect(wasm.getVersion()).toBeGreaterThanOrEqual(MIN_WASM_ABI_VERSION);
  });

  it('does not retry a deterministic failure (provenance mismatch)', async () => {
    const factory = vi.fn();
    const importer = vi.fn(async () => ({ default: factory, WATERSHED_WASM_SHA: '0123456789abcdef' }));
    __setGlueImporterForTests(importer);
    stubFetch(wasmBytes);
    quietConsole();

    await expect(loadWatershedNativeWithRetry(URLS, 10_000)).rejects.toThrow(/stamp mismatch/);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('classifies timeouts and network failures as retryable, bugs and mismatches as not', () => {
    expect(isRetryableWasmInitError(new WasmInitTimeoutError(5))).toBe(true);
    expect(isRetryableWasmInitError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableWasmInitError(new Error('watershed_native fetch failed 503 for x'))).toBe(true);
    expect(isRetryableWasmInitError(new Error('watershed_native fetch failed 404 for x'))).toBe(false);
    expect(isRetryableWasmInitError(new TypeError('glue.default is not a function'))).toBe(false);
    expect(isRetryableWasmInitError(new Error('watershed_native stamp mismatch: wasm=a'))).toBe(false);
  });
});

describe('bindNativeModule guards (#502 A)', () => {
  const fakeRaw = (overrides: Record<string, unknown> = {}): RawWatershedModule => {
    const raw: Record<string, unknown> = { HEAPF32: new Float32Array(16), HEAP32: new Int32Array(16), HEAPU8: new Uint8Array(64) };
    for (const name of Object.keys(WASM_ABI) as WasmAbiFunctionName[]) {
      // Variadic shims (length 0) are not arity-checked.
      raw[wasmExportName(name)] = (..._args: number[]) => 16;
    }
    return { ...raw, ...overrides } as unknown as RawWatershedModule;
  };

  it('allocateGrid returning 0 for a non-empty grid throws the HUD-classified heap error', () => {
    let calls = 0;
    const wasm = bindNativeModule(fakeRaw({
      _ws_allocateGrid: (..._args: number[]) => (calls++ === 0 ? 16 : 0),
    }));
    const err = (() => {
      try {
        wasm.allocateGrid(4096);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(isWasmHeapExhaustedError(err)).toBe(true);
    expect(String(err)).toMatch(/heap exhausted: allocateGrid\(4096\) returned 0/);
    expect(wasm.allocateGrid(0)).toBe(0);
  });

  it('allocateGrids frees what it allocated when a later block throws', () => {
    const freed: number[] = [];
    let next = 16;
    const wasm = {
      allocateGrid: (count: number) => {
        if (count > 100) throw new WasmHeapExhaustedError(count);
        const ptr = next;
        next += count * 4;
        return ptr;
      },
      freeGrid: (ptr: number) => { freed.push(ptr); },
    };
    expect(() => allocateGrids(wasm, [4, 0, 8, 1000, 2])).toThrow(WasmHeapExhaustedError);
    expect(freed).toEqual([16, 32]);
    expect(allocateGrids(wasm, [4, 0])).toEqual([64, 0]);
  });

  it('an export whose arity disagrees with the table is an ABI mismatch at bind (dev builds)', () => {
    const raw = fakeRaw({ _ws_stepShallowWater: (a: number, b: number) => a + b });
    expect(arityMismatches(raw)).toEqual(['_ws_stepShallowWater takes 2, table says 10']);
    expect(() => bindNativeModule(raw)).toThrow(/ABI mismatch: arity _ws_stepShallowWater takes 2, table says 10/);
  });

  it('the committed glue has no arity mismatch', async () => {
    const glue = await realGlue();
    const raw = await glue.default({ wasmBinary: wasmBytes });
    expect(arityMismatches(raw)).toEqual([]);
  });
});

describe('getWasm', () => {
  it('records init failure so the HUD can banner instead of showing a TS smoke value', async () => {
    __setGlueImporterForTests(async () => { throw new Error('glue 404'); });
    stubFetch(wasmBytes);
    quietConsole();

    await expect(getWasm()).rejects.toThrow('glue 404');
    expect(peekWasm()).toBeNull();
    expect(peekWasmInitError()?.message).toBe('glue 404');
  });

  it('caches one module per session', async () => {
    __setGlueImporterForTests(realGlue);
    const fetchMock = stubFetch(wasmBytes);
    quietConsole();

    const a = await getWasm();
    const b = await getWasm();
    expect(a).toBe(b);
    expect(peekWasm()).toBe(a);
    expect(peekWasmInitError()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveWasmInitTimeoutMs', () => {
  const envKey = 'WATERSHED_WASM_INIT_TIMEOUT_MS';
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[envKey];
    delete process.env[envKey];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[envKey];
    else process.env[envKey] = savedEnv;
  });

  it('defaults to WASM_INIT_TIMEOUT_MS', () => {
    expect(resolveWasmInitTimeoutMs('')).toBe(WASM_INIT_TIMEOUT_MS);
    expect(WASM_INIT_TIMEOUT_MS).toBe(8000);
  });

  it('reads ?wasmInitTimeout= from search', () => {
    expect(resolveWasmInitTimeoutMs('?wasmInitTimeout=1500')).toBe(1500);
  });

  it('ignores invalid query values', () => {
    expect(resolveWasmInitTimeoutMs('?wasmInitTimeout=0')).toBe(WASM_INIT_TIMEOUT_MS);
    expect(resolveWasmInitTimeoutMs('?wasmInitTimeout=abc')).toBe(WASM_INIT_TIMEOUT_MS);
  });

  it('prefers env override over query', () => {
    process.env[envKey] = '250';
    expect(resolveWasmInitTimeoutMs('?wasmInitTimeout=9999')).toBe(250);
  });
});
