/**
 * wasmLoader.ts — load watershed_native once, hash it once (#467).
 *
 * One path for both owners of the module: `getWasm()` on the main thread
 * (`?simWorker=0`, WasmWaterForceTest) and `getWorkerWasm()` in the sim worker
 * (src/sim/workerWasm.ts). Each session fetches the glue and the wasm exactly
 * once:
 *
 *   1. `import(glue)` and `fetch(wasm)` in parallel.
 *   2. Hash the fetched wasm bytes; they must match WASM_BINARY_SHA, and the
 *      glue's own `WATERSHED_WASM_SHA` export (appended by build.sh) must name
 *      the same wasm. A stale or mixed pair is rejected before it runs.
 *   3. Hand those same bytes to the factory as `wasmBinary` — the glue never
 *      fetches the wasm itself, so the bytes hashed are the bytes that run.
 *   4. Check the ABI version and bind the `_ws_*` exports (wasmAbi.ts).
 *
 * The glue is imported by URL, never evaluated from a string or a blob, so the
 * page runs under `script-src 'self' 'wasm-unsafe-eval'`.
 *
 * #502 C: the deadline aborts the losing wasm fetch, and a timeout or a
 * network failure is retried once (`loadWatershedNativeWithRetry`) before the
 * session-wide fallback; a provenance or ABI mismatch is deterministic and is
 * not.
 */

import { BUILD_IDENTITY, GRAPHICS_BOOT_TOKEN } from '../../buildIdentity';
import { getAssetBaseUrl } from '../../utils/assetBaseUrl';
import {
  bindNativeModule,
  MIN_WASM_ABI_VERSION,
  type RawWatershedModule,
  type WatershedNativeModule,
} from './wasmAbi';
import { WASM_ARTIFACT_STAMP, WASM_BINARY_SHA } from './wasmArtifactStamp';
import { wantsWasmTrapTest } from './wasmTrapMarker';

/** Default deadline for watershed_native load + initialisation (ms). */
export const WASM_INIT_TIMEOUT_MS = 8000;

const WASM_LOG_PREFIX = '[Watershed WASM]';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when load + init does not settle within the deadline. */
export class WasmInitTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`watershed_native init timed out after ${timeoutMs}ms`);
    this.name = 'WasmInitTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function isWasmInitTimeoutError(error: unknown): boolean {
  return error instanceof WasmInitTimeoutError
    || (error instanceof Error && error.message.includes('init timed out after'));
}

/** Served glue/binary bytes disagree with the stamp this bundle was built against. */
export const PROVENANCE_MISMATCH_MARKER = 'stamp mismatch';

export class WasmProvenanceMismatchError extends Error {
  constructor(detail: string) {
    super(`watershed_native ${PROVENANCE_MISMATCH_MARKER}: ${detail}`);
    this.name = 'WasmProvenanceMismatchError';
  }
}

export function isWasmProvenanceMismatchError(error: unknown): boolean {
  return error instanceof WasmProvenanceMismatchError
    || (error instanceof Error && error.message.includes(PROVENANCE_MISMATCH_MARKER));
}

// ---------------------------------------------------------------------------
// Deadline
// ---------------------------------------------------------------------------

/**
 * A Node-side env override (Vitest, the WASM integration suite); always
 * undefined in a browser, which has no `process`.
 */
function nodeEnv(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Resolve the WASM init deadline (ms). Precedence: env override, then ?wasmInitTimeout=,
 * then WASM_INIT_TIMEOUT_MS. Invalid values fall back to the default.
 */
export function resolveWasmInitTimeoutMs(search?: string): number {
  const envRaw = nodeEnv('WATERSHED_WASM_INIT_TIMEOUT_MS');
  if (envRaw != null && envRaw !== '') {
    const parsed = Number(envRaw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }

  const raw =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const query = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`).get('wasmInitTimeout');
  if (query != null && query !== '') {
    const parsed = Number(query);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }

  return WASM_INIT_TIMEOUT_MS;
}

/**
 * `promise`, or a rejection with `onTimeout()` after `timeoutMs` — whichever
 * settles first. Shared by the loader and the sim worker handshake (#455) so
 * neither can hang the boot.
 */
export function raceWithDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const guarded = promise.then(
    (value) => {
      if (settled) return value;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      return value;
    },
    (error: unknown) => {
      if (settled) return Promise.reject(error);
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      return Promise.reject(error);
    },
  );

  const deadline = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(onTimeout());
    }, timeoutMs);
  });

  return Promise.race([guarded, deadline]);
}

// ---------------------------------------------------------------------------
// URLs and hashing
// ---------------------------------------------------------------------------

function withArtifactStamp(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${WASM_ARTIFACT_STAMP}`;
}

/**
 * Absolute, stamped URL of a `public/` asset, resolved against the page and the
 * Vite base. Workers cannot do this themselves — their `self.location` is the
 * worker script (under `src/…` in dev, `assets/` in a build), not the page — so
 * the sim worker is handed these URLs in its INIT message (#455).
 */
export function resolvePublicAsset(path: string): string {
  const rawBase = getAssetBaseUrl();
  const baseWithSlash = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  const envBase = nodeEnv('WATERSHED_WASM_BASE');
  const runtimeHref =
    typeof window !== 'undefined'
      ? window.location.href
      : typeof globalThis.location?.href === 'string'
        ? globalThis.location.href
        : envBase;
  const absoluteBase =
    runtimeHref
      ? new URL(baseWithSlash, runtimeHref).href
      : baseWithSlash;
  return withArtifactStamp(new URL(path, absoluteBase).href);
}

/** First 16 hex chars of sha256(bytes) — the `sha256sum | cut -c1-16` of build.sh. */
export async function sha256Hex16(...parts: Uint8Array[]): Promise<string> {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.byteLength;
  }
  const digest = await crypto.subtle.digest('SHA-256', joined);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`watershed_native fetch failed ${response.status} for ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

type NativeFactory = (options: {
  wasmBinary: Uint8Array;
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<RawWatershedModule>;

/** The ES module build.sh produces: the factory plus the wasm it was linked with. */
export interface WatershedGlueModule {
  default: NativeFactory;
  WATERSHED_WASM_SHA?: string;
}

type GlueImporter = (url: string) => Promise<WatershedGlueModule>;

const importGlueByUrl: GlueImporter = (url) =>
  import(/* @vite-ignore */ url) as Promise<WatershedGlueModule>;

let importGlue: GlueImporter = importGlueByUrl;

/** Test-only: replace the glue `import()` (null restores the real one). */
export function __setGlueImporterForTests(importer: GlueImporter | null): void {
  importGlue = importer ?? importGlueByUrl;
}

export interface NativeAssetUrls {
  /** Absolute, stamped URL of watershed_native.js. */
  glue: string;
  /** Absolute, stamped URL of watershed_native.wasm. */
  wasm: string;
}

function logTerminal(error: Error, timeoutMs: number): void {
  if (isWasmInitTimeoutError(error)) {
    console.error(`${WASM_LOG_PREFIX} timed-out(${timeoutMs}ms)`);
  } else if (isWasmProvenanceMismatchError(error)) {
    console.error(`${WASM_LOG_PREFIX} provenance-mismatch(${error.message})`);
  } else {
    console.error(`${WASM_LOG_PREFIX} failed(${error.message})`);
  }
}

export interface NativeLoadOptions {
  /**
   * `?wasmTrapTest=1` (#502): after bind, call the Debug-only `ws_trapTest`
   * and reject with the WasmTrapError naming the function it trapped in.
   */
  trapTest?: boolean;
}

/**
 * Fetch, verify, instantiate and bind one module instance. Rejects with
 * WasmInitTimeoutError, WasmProvenanceMismatchError, WasmAbiMismatchError,
 * WasmTrapError or a plain Error; the terminal outcome is logged either way.
 * The deadline aborts the wasm fetch if it is still in flight (#502 C), so a
 * lost request does not keep the connection busy for the retry.
 */
export async function loadWatershedNative(
  urls: NativeAssetUrls,
  timeoutMs: number,
  options: NativeLoadOptions = {},
): Promise<WatershedNativeModule> {
  console.info(`${WASM_LOG_PREFIX} init started url=${urls.glue} stamp=${WASM_ARTIFACT_STAMP}`);
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  try {
    const loaded = await raceWithDeadline(
      (async () => {
        const [glue, wasmBytes] = await Promise.all([
          importGlue(urls.glue),
          fetchBytes(urls.wasm, abort?.signal),
        ]);
        const wasmSha = await sha256Hex16(wasmBytes);
        const glueSha = glue.WATERSHED_WASM_SHA ?? 'none';
        console.info(
          `${WASM_LOG_PREFIX} wasm bytes=${wasmBytes.byteLength} sha=${wasmSha} glue-for=${glueSha} expected=${WASM_BINARY_SHA}`,
        );
        if (wasmSha !== WASM_BINARY_SHA) {
          throw new WasmProvenanceMismatchError(`wasm=${wasmSha} expected=${WASM_BINARY_SHA}`);
        }
        if (glueSha !== WASM_BINARY_SHA) {
          throw new WasmProvenanceMismatchError(`glue built for wasm=${glueSha} expected=${WASM_BINARY_SHA}`);
        }

        const raw = await glue.default({
          wasmBinary: wasmBytes,
          // Nothing else is located with wasmBinary set; kept so a stray
          // lookup resolves under public/ rather than the glue's directory.
          locateFile: (path: string) => new URL(path, urls.wasm).href,
        });

        const getVersion = raw._ws_getVersion;
        const version = typeof getVersion === 'function' ? getVersion() : -1;
        const abiOk = version >= MIN_WASM_ABI_VERSION;
        console.info(
          `${WASM_LOG_PREFIX} abi=${version} (min=${MIN_WASM_ABI_VERSION}, ${abiOk ? 'ok' : 'rejected'})`,
        );
        if (!abiOk) {
          throw new Error(
            `watershed_native ABI ${version} is older than required ${MIN_WASM_ABI_VERSION}`,
          );
        }
        const module = bindNativeModule(raw);
        // The parser is not on the boot path: loaded only for ?wasmTrapTest=1.
        if (options.trapTest) await (await import('./wasmTrap')).runWasmTrapTest(raw, urls.wasm);
        return { module, version };
      })(),
      timeoutMs,
      () => {
        abort?.abort();
        return new WasmInitTimeoutError(timeoutMs);
      },
    );
    console.info(`${WASM_LOG_PREFIX} ready (abi=${loaded.version})`);
    return loaded.module;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logTerminal(err, timeoutMs);
    throw err;
  }
}

/**
 * A failure worth one more attempt (#502 C): the deadline, or the network
 * losing a request. A stamp / ABI mismatch or a trap would fail the same way
 * again, so those go straight to the fallback.
 */
export function isRetryableWasmInitError(error: unknown): boolean {
  if (isWasmInitTimeoutError(error)) return true;
  if (!(error instanceof Error)) return false;
  // fetch() / import() reject with a TypeError on a network failure ("Failed
  // to fetch", "NetworkError…", "error loading dynamically imported module");
  // a 5xx is fetchBytes' own message. Other TypeErrors are bugs, not weather.
  if (error instanceof TypeError && /fetch|network|load/i.test(error.message)) return true;
  return /fetch failed 5\d\d/.test(error.message);
}

/** loadWatershedNative, retried once on a timeout or network failure (#502 C). */
export async function loadWatershedNativeWithRetry(
  urls: NativeAssetUrls,
  timeoutMs: number,
  options: NativeLoadOptions = {},
): Promise<WatershedNativeModule> {
  try {
    return await loadWatershedNative(urls, timeoutMs, options);
  } catch (error) {
    if (!isRetryableWasmInitError(error)) throw error;
    console.warn(`${WASM_LOG_PREFIX} retrying once after: ${(error as Error).message}`);
    return loadWatershedNative(urls, timeoutMs, options);
  }
}

/** Worst case of loadWatershedNativeWithRetry: two full deadlines. */
export function retryBudgetMs(timeoutMs: number): number {
  return 2 * timeoutMs;
}

// ---------------------------------------------------------------------------
// Main-thread singleton
// ---------------------------------------------------------------------------

let _modulePromise: Promise<WatershedNativeModule> | null = null;
let _loaded: WatershedNativeModule | null = null;
let _initError: Error | null = null;

/**
 * Load (or return the cached) main-thread module. Only the `?simWorker=0`
 * path and dev tools use it — by default the sim worker owns the one instance.
 *
 * Safe to call many times — subsequent calls return the same settled promise.
 * On failure (throw, mismatch or deadline — a deadline or network failure is
 * retried once first) the promise **rejects**; call sites must `.catch()` and
 * fall back to the TypeScript implementations.
 */
export function getWasm(): Promise<WatershedNativeModule> {
  if (_modulePromise) return _modulePromise;

  console.info(`${WASM_LOG_PREFIX} build-id=${BUILD_IDENTITY} boot=${GRAPHICS_BOOT_TOKEN}`);
  _modulePromise = loadWatershedNativeWithRetry(
    {
      glue: resolvePublicAsset('watershed_native.js'),
      wasm: resolvePublicAsset('watershed_native.wasm'),
    },
    resolveWasmInitTimeoutMs(),
    { trapTest: wantsWasmTrapTest() },
  ).then(
    (loaded) => {
      _loaded = loaded;
      _initError = null;
      return loaded;
    },
    (error: Error) => {
      _initError = error;
      throw error;
    },
  );
  return _modulePromise;
}

/** Already-resolved native module, or null if `getWasm()` has not finished. */
export function peekWasm(): WatershedNativeModule | null {
  return _loaded;
}

/** Last `getWasm()` failure, or null if native init succeeded / has not run. */
export function peekWasmInitError(): Error | null {
  return _initError;
}

/** Test-only: drop the singleton so the next `getWasm()` hits the loader again. */
export function __resetWasmLoaderForTests(): void {
  _modulePromise = null;
  _loaded = null;
  _initError = null;
}
