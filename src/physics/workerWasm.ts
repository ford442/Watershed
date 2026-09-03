/// <reference lib="webworker" />

import type { WatershedNativeModule } from '../systems/water/WatershedWasm';
import {
  isWasmInitTimeoutError,
  resolveWasmInitTimeoutMs,
  WasmInitTimeoutError,
} from '../systems/water/WatershedWasm';
import { WASM_ARTIFACT_STAMP } from '../systems/water/wasmArtifactStamp';

type WatershedNativeFactory = (options?: {
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<WatershedNativeModule>;

const WASM_LOG_PREFIX = '[Watershed WASM]';

let modulePromise: Promise<WatershedNativeModule | null> | null = null;

function resolveWorkerAsset(path: string): string {
  const base =
    typeof self !== 'undefined' && typeof self.location?.href === 'string'
      ? self.location.href
      : '/';
  const url = new URL(path, base).href;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${WASM_ARTIFACT_STAMP}`;
}

function workerSearchString(): string | undefined {
  if (typeof self !== 'undefined' && typeof self.location?.search === 'string') {
    return self.location.search;
  }
  return undefined;
}

function raceWithDeadline<T>(
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

/**
 * Load watershed_native inside a dedicated worker.
 * Returns null when the glue module is missing or init fails/times out so
 * Rapier can fall back to TS math.
 */
export async function getWorkerWasm(): Promise<WatershedNativeModule | null> {
  if (modulePromise) return modulePromise;

  const timeoutMs = resolveWasmInitTimeoutMs(workerSearchString());

  modulePromise = (async () => {
    const wasmJsUrl = resolveWorkerAsset('watershed_native.js');
    let terminalLogged = false;

    try {
      console.info(`${WASM_LOG_PREFIX} init started url=${wasmJsUrl} stamp=${WASM_ARTIFACT_STAMP}`);

      const mod = await import(/* @vite-ignore */ wasmJsUrl) as { default: WatershedNativeFactory };
      const factory = mod.default;
      const loaded = await raceWithDeadline(
        factory({
          locateFile: (path: string) => resolveWorkerAsset(path),
        }),
        timeoutMs,
        () => new WasmInitTimeoutError(timeoutMs),
      );

      const version = loaded.getVersion();
      terminalLogged = true;
      console.info(`${WASM_LOG_PREFIX} ready (abi=${version})`);
      return loaded;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!terminalLogged) {
        terminalLogged = true;
        if (isWasmInitTimeoutError(err)) {
          console.error(`${WASM_LOG_PREFIX} timed-out(${timeoutMs}ms)`);
        } else {
          console.error(`${WASM_LOG_PREFIX} failed(${err.message})`);
        }
      }
      console.error('[physics worker] native init failed; using TS water-force fallback', error);
      return null;
    }
  })();

  return modulePromise;
}
