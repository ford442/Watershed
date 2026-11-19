/**
 * The bed is repaired where it is written (#575): a NaN bed cell used to give
 * a NaN η on every step, because the lift purges η, u, w but not b.
 */
import { describe, expect, it } from 'vitest';
import { loadNativeFromDisk, nativePairOnDisk } from '../../testing/nativeFromDisk';
import { SWE_DRY_BANK_BED, sanitizeBed, sweBedRepairCount } from './sweBedGuard';
import { BATHYMETRY_DRY_BED } from './bathymetrySampler';
import { createWasmSweSim } from './sweSim';

describe('sanitizeBed', () => {
  it('replaces every non-finite cell with a dry bank and counts them', () => {
    const before = sweBedRepairCount();
    const b = new Float32Array([0.1, Number.NaN, 0.2, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.3]);
    expect(sanitizeBed(b)).toBe(3);
    expect(Array.from(b)).toEqual([0.1, SWE_DRY_BANK_BED, 0.2, SWE_DRY_BANK_BED, SWE_DRY_BANK_BED, -0.3].map(Math.fround));
    expect(sweBedRepairCount()).toBe(before + 3);
    expect(sanitizeBed(b)).toBe(0);
  });

  it('repairs to the bank the rasterizer writes for a non-finite floor', () => {
    expect(SWE_DRY_BANK_BED).toBe(BATHYMETRY_DRY_BED);
  });
});

const runNative = process.env.WATERSHED_WASM_INTEGRATION === '1' && nativePairOnDisk();

(runNative ? describe : describe.skip)('commitBed on the native stepper', () => {
  it('a NaN bed cell committed through commitBed never reaches η', async () => {
    const wasm = await loadNativeFromDisk();
    const sim = createWasmSweSim(wasm, 16, 12, 0.5);
    try {
      sim.b[5 * 16 + 7] = Number.NaN;
      expect(sim.commitBed()).toBe(1);
      for (let k = 0; k < 20; k += 1) {
        sim.step({ dt: 1 / 60, g: 9.80665, H: 1, originX: 0, originZ: 0, events: [] });
      }
      expect(sim.h.every(Number.isFinite)).toBe(true);
      expect(sim.b.every(Number.isFinite)).toBe(true);
    } finally {
      sim.dispose();
    }
  });
});
