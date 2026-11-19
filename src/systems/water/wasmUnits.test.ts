/**
 * The ABI brands (#575) are types only: this file is checked by
 * `pnpm typecheck:test`, where each @ts-expect-error must find an error, and
 * runs as an ordinary test so the module is exercised. A swap between two
 * locals of different brands at a call site is a compile error; plain numbers
 * still pass.
 */
import { describe, expect, it } from 'vitest';
import { asPtr, type Cells, type F32, type Metres, type ParticleSoA, type Ptr, type Seconds, type U32, type WatershedNativeModule } from './wasmAbi';

describe('wasmUnits brands', () => {
  it('reject a swapped call at compile time and erase at runtime', () => {
    const calls: number[][] = [];
    const wasm = {
      stepShallowWater: (...args: number[]) => { calls.push(args); return args[6]; },
      histogramF32: (...args: number[]) => { calls.push(args); return 1; },
    } as unknown as Pick<WatershedNativeModule, 'stepShallowWater' | 'histogramF32'>;
    const h: Ptr<F32> = 8;
    const width: Cells = 4;
    const height: Cells = 3;
    const dt: Seconds = 0.016;
    const dx: Metres = 0.75;
    const H: Metres = 1.2;
    wasm.stepShallowWater(h, h, h, 0, width, height, dt, 9.8, dx, H);
    wasm.stepShallowWater(8, 8, 8, 0, 4, 3, 0.016, 9.8, 0.75, 1.2); // plain numbers pass
    // @ts-expect-error dt and dx swapped: Metres is not Seconds
    wasm.stepShallowWater(h, h, h, 0, width, height, dx, 9.8, dt, H);
    const soa: Ptr<ParticleSoA> = 16;
    // @ts-expect-error a particle block is not a grid plane
    wasm.stepShallowWater(soa, h, h, 0, width, height, dt, 9.8, dx, H);
    // @ts-expect-error f32 bins where the export takes u32 bins
    wasm.histogramF32(h, 4, 0, 1, h);
    const bins: Ptr<U32> = asPtr<U32>(h);
    wasm.histogramF32(h, 4, 0, 1, bins);
    expect(calls).toHaveLength(6);
    expect(calls[0]).toEqual(calls[1]);
  });
});
