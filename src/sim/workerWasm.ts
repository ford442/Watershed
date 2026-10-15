/// <reference lib="webworker" />

import type { WatershedNativeModule } from '../systems/water/wasmAbi';
import { loadWatershedNative, resolveWasmInitTimeoutMs } from '../systems/water/wasmLoader';

let modulePromise: Promise<WatershedNativeModule | null> | null = null;
let lastInitError: string | null = null;

function workerSearchString(): string | undefined {
  if (typeof self !== 'undefined' && typeof self.location?.search === 'string') {
    return self.location.search;
  }
  return undefined;
}

/** Why the last `getWorkerWasm` returned null (the message the HUD classifies), or null. */
export function peekWorkerWasmInitError(): string | null {
  return lastInitError;
}

/**
 * Load watershed_native inside the sim worker (#455) — the one instance per
 * session (#462). Same loader as the main thread (wasmLoader.ts): one fetch
 * each of glue and wasm, the stamp checked on the bytes that run, and the ABI
 * floor enforced. Returns null when load, verification or init fails or times
 * out, so the caller can fall back.
 *
 * @param failureNote  Logged with the error; names the caller's fallback.
 * @param assetUrl     Absolute, stamped URL of a public/ asset, resolved by the
 *                     PAGE and handed over in INIT. There is deliberately no
 *                     default: a worker's own location is its script
 *                     (src/... in dev, assets/ in a build), so resolving
 *                     public/ against it 404s.
 */
export function getWorkerWasm(
  failureNote: string,
  assetUrl: (path: string) => string,
): Promise<WatershedNativeModule | null> {
  if (modulePromise) return modulePromise;

  modulePromise = loadWatershedNative(
    { glue: assetUrl('watershed_native.js'), wasm: assetUrl('watershed_native.wasm') },
    resolveWasmInitTimeoutMs(workerSearchString()),
  ).then(
    (loaded) => loaded,
    (error: unknown) => {
      lastInitError = error instanceof Error ? error.message : String(error);
      console.error(failureNote, error);
      return null;
    },
  );
  return modulePromise;
}
