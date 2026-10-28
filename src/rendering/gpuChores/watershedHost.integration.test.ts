/**
 * watershedHost.integration.test.ts — the chore NaN guards survive the REAL binary.
 *
 * chores.cpp skips non-finite samples with std::isfinite. Under -ffast-math
 * (which implies -ffinite-math-only) clang folds those guards to `true`, so a NaN
 * poisons the mean and an Inf lands in a histogram bin (#454). The Release build
 * is IEEE now (no -ffast-math); this drives the compiled module through the host
 * the HUD uses and fails if the guards ever get optimised away again.
 *
 * Gated like the other integration tests (`pnpm test:wasm`): needs public/*.wasm.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WatershedNativeModule } from '../../systems/water/wasmAbi';
import { bindChoreWasm, createWatershedCpuHost, resetChoreWasmBinding } from './watershedHost';
import { loadNativeFromDisk } from '../../testing/nativeFromDisk';

const loaded = vi.hoisted(() => ({ mod: null as WatershedNativeModule | null }));

// createWatershedCpuHost() best-effort binds getWasm(); hand it the module under test.
vi.mock('../../systems/water/wasmLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../systems/water/wasmLoader')>()),
  getWasm: () => (loaded.mod ? Promise.resolve(loaded.mod) : Promise.reject(new Error('not loaded'))),
}));

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');
const wasmPath = resolve(publicDir, 'watershed_native.wasm');
const runIntegration = process.env.WATERSHED_WASM_INTEGRATION === '1' && existsSync(wasmPath);
const describeIntegration = runIntegration ? describe : describe.skip;

const loadModule = loadNativeFromDisk;

describeIntegration('gpu-chores wasm lane — non-finite samples are skipped (real binary)', () => {
  const samples = new Float32Array([1, Number.NaN, 3, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);

  beforeAll(async () => {
    loaded.mod = await loadModule();
    bindChoreWasm(loaded.mod);
  });

  afterAll(() => {
    resetChoreWasmBinding();
  });

  it('reduceF32Grid ignores NaN / ±Inf and returns finite min / max / mean', () => {
    const host = createWatershedCpuHost();
    expect(host.isWasmReady()).toBe(true);
    const r = host.reduceF32(samples, true);
    expect(Number.isFinite(r.min)).toBe(true);
    expect(Number.isFinite(r.max)).toBe(true);
    expect(Number.isFinite(r.mean)).toBe(true);
    expect([r.min, r.max, r.mean]).toEqual([1, 3, 2]);
  });

  it('histogramF32 bins only the finite samples', () => {
    const host = createWatershedCpuHost();
    const h = host.histogramF32(samples, 0, 4, true);
    const total = h.bins.reduce((sum, n) => sum + n, 0);
    expect(total).toBe(2);
  });
});
