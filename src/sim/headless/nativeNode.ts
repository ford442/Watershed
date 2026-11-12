/**
 * nativeNode.ts — the shipped watershed_native pair, loaded in Node (#556 B.1).
 *
 * The same loader the browser runs (wasmLoader.ts: stamp check on the bytes
 * that run, ABI equality, `_ws_*` binding), handed the bytes from `fs` the way
 * the page hands it its prefetched ones (`wasmBytes`, #554 B.4) — so nothing
 * fetches and the Release glue's `ENVIRONMENT='web,worker'` is never asked to
 * be Node: with `wasmBinary` given the glue instantiates straight from memory.
 * The glue is `import()`ed from its file URL, untransformed.
 *
 * Headless only: never imported by app code (scripts/check-dependency-direction.mjs).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { WatershedNativeModule } from '../../systems/water/wasmAbi';
import { loadWatershedNative } from '../../systems/water/wasmLoader';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The committed pair under public/, or a build under `WATERSHED_NATIVE_DIR` (the Debug-wasm job's). */
export function nativeDir(): string {
  return resolve(repoRoot, process.env.WATERSHED_NATIVE_DIR ?? 'public');
}

let loading: Promise<WatershedNativeModule> | null = null;

/** One module per process: a run's grids all live in it, and a campaign makes many runs. */
export function loadHeadlessNative(): Promise<WatershedNativeModule> {
  loading ??= (async () => {
    const dir = nativeDir();
    const wasmPath = resolve(dir, 'watershed_native.wasm');
    // The loader narrates every step on the console; a campaign run is not the place for it.
    const info = console.info;
    console.info = () => undefined;
    try {
      return await loadWatershedNative(
        {
          glue: pathToFileURL(resolve(dir, 'watershed_native.js')).href,
          wasm: pathToFileURL(wasmPath).href,
        },
        30_000,
        { wasmBytes: new Uint8Array(readFileSync(wasmPath)) },
      );
    } finally {
      console.info = info;
    }
  })();
  return loading;
}
