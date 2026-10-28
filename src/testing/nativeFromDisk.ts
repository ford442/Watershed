/**
 * Test-only: the committed public/watershed_native pair, instantiated from
 * disk and bound through wasmAbi.ts exactly as the loader binds it. Node has
 * no fetch for file: URLs, so the bytes go in as `wasmBinary`, the same
 * option wasmLoader.ts uses in the browser.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { bindNativeModule, type WatershedNativeModule } from '../systems/water/wasmAbi';
import type { WatershedGlueModule } from '../systems/water/wasmLoader';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/**
 * Directory of the pair under test: public/ (the shipped pair) unless
 * WATERSHED_NATIVE_DIR names another, relative to the repo root — CI's
 * Debug-wasm job points it at emscripten/build-debug/out.
 */
export const NATIVE_DIR = resolve(repoRoot, process.env.WATERSHED_NATIVE_DIR ?? 'public');
/** True when the pair under test is the shipped one in public/. */
export const NATIVE_IS_SHIPPED = NATIVE_DIR === resolve(repoRoot, 'public');
export const NATIVE_WASM_PATH = resolve(NATIVE_DIR, 'watershed_native.wasm');
export const NATIVE_GLUE_PATH = resolve(NATIVE_DIR, 'watershed_native.js');

/** True when the pair exists on disk (it is committed, so normally always). */
export function nativePairOnDisk(): boolean {
  return existsSync(NATIVE_WASM_PATH) && existsSync(NATIVE_GLUE_PATH);
}

export async function loadNativeFromDisk(): Promise<WatershedNativeModule> {
  const glue = await import(/* @vite-ignore */ pathToFileURL(NATIVE_GLUE_PATH).href) as WatershedGlueModule;
  const raw = await glue.default({ wasmBinary: new Uint8Array(readFileSync(NATIVE_WASM_PATH)) });
  return bindNativeModule(raw);
}
