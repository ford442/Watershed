/// <reference lib="webworker" />

import type { WatershedNativeModule } from '../systems/water/WatershedWasm';
import { WASM_ARTIFACT_STAMP } from '../systems/water/wasmArtifactStamp';

type WatershedNativeFactory = (options?: {
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<WatershedNativeModule>;

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

/**
 * Load watershed_native inside a dedicated worker.
 * Returns null when the glue module is missing so Rapier can fall back to TS math.
 */
export async function getWorkerWasm(): Promise<WatershedNativeModule | null> {
  if (modulePromise) return modulePromise;

  modulePromise = (async () => {
    try {
      const wasmJsUrl = resolveWorkerAsset('watershed_native.js');
      const mod = await import(/* @vite-ignore */ wasmJsUrl) as { default: WatershedNativeFactory };
      const factory = mod.default;
      return await factory({
        locateFile: (path: string) => resolveWorkerAsset(path),
      });
    } catch (error) {
      console.error('[physics worker] native init failed; using TS water-force fallback', error);
      return null;
    }
  })();

  return modulePromise;
}
