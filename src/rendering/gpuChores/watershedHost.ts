/**
 * Watershed CPU host for gpu-chores.
 *
 * The only module under gpuChores/ that may import WatershedWasm. Chore
 * kernels stay in emscripten/chores.cpp (added in ABI 5); missing exports
 * make the wasm lane decline. The loader requires the exact ABI
 * (WASM_ABI_VERSION, #533) and binds every export, so any accepted binary
 * already has them and the decline path is defensive.
 */

import { warnRejected, WS_OK, type WatershedNativeModule } from '../../systems/water/wasmAbi';
import {
  blurSeparableF32,
  downsampleF32,
  histogramF32,
  lumaHistogramU8,
  reduceF32,
} from './cpuMath';
import type { CpuChoreHost } from './cpuBackend';

let boundWasm: WatershedNativeModule | null = null;

export function hasChoreExports(mod: WatershedNativeModule | null | undefined): boolean {
  return typeof mod?.reduceF32Grid === 'function'
    && typeof mod.histogramF32 === 'function'
    && typeof mod.downsampleF32 === 'function'
    && typeof mod.blurSeparableF32 === 'function';
}

export function bindChoreWasm(mod: WatershedNativeModule | null): void {
  boundWasm = hasChoreExports(mod) ? mod : null;
}

function withHeap<T>(
  wasm: WatershedNativeModule,
  values: Float32Array,
  run: (ptr: number) => T,
): T {
  const onHeap = values.buffer === wasm.HEAPF32.buffer;
  if (onHeap) {
    return run(values.byteOffset);
  }
  const ptr = wasm.allocateGrid(values.length);
  try {
    wasm.HEAPF32.set(values, ptr >> 2);
    return run(ptr);
  } finally {
    wasm.freeGrid(ptr);
  }
}

/**
 * The main-thread host. It never loads the module itself: WaterForceSystem
 * binds one (`bindChoreWasm`) only when the session's module lives on this
 * thread (`wasm-main`). On a sim-worker boot the chores run in the worker
 * (heightfield.ts → CHORES) and this host stays on the TS math.
 */
export function createWatershedCpuHost(): CpuChoreHost {
  return createNativeChoreHost(() => boundWasm);
}

/**
 * A chore host over whichever module `resolve` returns — the bound main-thread
 * module, or the sim worker's own (simWorkerCore.ts). Falls back to the TS
 * math per call when the module or the export is missing.
 */
export function createNativeChoreHost(resolve: () => WatershedNativeModule | null): CpuChoreHost {
  return {
    isWasmReady: () => hasChoreExports(resolve()),

    reduceF32(values, useWasm) {
      const wasm = resolve();
      if (!useWasm || !wasm?.reduceF32Grid) return reduceF32(values);
      return withHeap(wasm, values, (ptr) => {
        const outPtr = wasm.allocateGrid(3);
        try {
          // Rejected (#533): the out block is untouched — use the TS math, not it.
          if (wasm.reduceF32Grid!(ptr, values.length, outPtr) !== WS_OK) {
            warnRejected('reduceF32Grid', `count=${values.length}`);
            return reduceF32(values);
          }
          const base = outPtr >> 2;
          return {
            kind: 'grid-reduce' as const,
            min: wasm.HEAPF32[base],
            max: wasm.HEAPF32[base + 1],
            mean: wasm.HEAPF32[base + 2],
            count: values.length,
          };
        } finally {
          wasm.freeGrid(outPtr);
        }
      });
    },

    histogramF32(values, rangeMin, rangeMax, useWasm) {
      const wasm = resolve();
      if (!useWasm || !wasm?.histogramF32) {
        return histogramF32(values, values.length, rangeMin, rangeMax);
      }
      const reduced = reduceF32(values);
      const lo = rangeMin ?? reduced.min;
      const hi = rangeMax ?? reduced.max;
      return withHeap(wasm, values, (ptr) => {
        const binsPtr = wasm.allocateGrid(256);
        try {
          if (wasm.histogramF32!(ptr, values.length, lo, hi, binsPtr) !== WS_OK) {
            warnRejected('histogramF32', `count=${values.length}`);
            return histogramF32(values, values.length, rangeMin, rangeMax);
          }
          const bins = new Uint32Array(256);
          const base = binsPtr >> 2;
          for (let i = 0; i < 256; i += 1) {
            bins[i] = wasm.HEAP32[base + i] >>> 0;
          }
          return { kind: 'luma-histogram' as const, bins, count: values.length };
        } finally {
          wasm.freeGrid(binsPtr);
        }
      });
    },

    lumaHistogramU8(rgba, pixelCount, useWasm) {
      const wasm = resolve();
      if (!useWasm || !wasm?.lumaHistogramU8) {
        return lumaHistogramU8(rgba, pixelCount);
      }
      const bytes = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba);
      const floatCount = Math.ceil(bytes.byteLength / 4);
      const ptr = wasm.allocateGrid(floatCount);
      try {
        wasm.HEAPU8.set(bytes, ptr);
        const binsPtr = wasm.allocateGrid(256);
        try {
          if (wasm.lumaHistogramU8!(ptr, pixelCount, binsPtr) !== WS_OK) {
            warnRejected('lumaHistogramU8', `pixels=${pixelCount}`);
            return lumaHistogramU8(rgba, pixelCount);
          }
          const bins = new Uint32Array(256);
          const base = binsPtr >> 2;
          for (let i = 0; i < 256; i += 1) {
            bins[i] = wasm.HEAP32[base + i] >>> 0;
          }
          return { kind: 'luma-histogram' as const, bins, count: pixelCount };
        } finally {
          wasm.freeGrid(binsPtr);
        }
      } finally {
        wasm.freeGrid(ptr);
      }
    },

    downsampleF32(values, width, height, destWidth, destHeight, useWasm) {
      const wasm = resolve();
      if (!useWasm || !wasm?.downsampleF32) {
        return downsampleF32(values, width, height, destWidth, destHeight);
      }
      return withHeap(wasm, values, (ptr) => {
        const destCount = destWidth * destHeight;
        const dstPtr = wasm.allocateGrid(destCount);
        try {
          if (wasm.downsampleF32!(ptr, width, height, dstPtr, destWidth, destHeight) !== WS_OK) {
            warnRejected('downsampleF32', `${width}x${height}`);
            return downsampleF32(values, width, height, destWidth, destHeight);
          }
          const out = new Float32Array(destCount);
          out.set(wasm.HEAPF32.subarray(dstPtr >> 2, (dstPtr >> 2) + destCount));
          return {
            kind: 'downsample-2d' as const,
            values: out,
            width: destWidth,
            height: destHeight,
          };
        } finally {
          wasm.freeGrid(dstPtr);
        }
      });
    },

    blurSeparableF32(values, width, height, useWasm) {
      const wasm = resolve();
      if (!useWasm || !wasm?.blurSeparableF32) {
        return blurSeparableF32(values, width, height);
      }
      return withHeap(wasm, values, (ptr) => {
        const dstPtr = wasm.allocateGrid(values.length);
        try {
          if (wasm.blurSeparableF32!(ptr, dstPtr, width, height) !== WS_OK) {
            warnRejected('blurSeparableF32', `${width}x${height}`);
            return blurSeparableF32(values, width, height);
          }
          const out = new Float32Array(values.length);
          out.set(wasm.HEAPF32.subarray(dstPtr >> 2, (dstPtr >> 2) + values.length));
          return { kind: 'separable-blur' as const, values: out, width, height };
        } finally {
          wasm.freeGrid(dstPtr);
        }
      });
    },
  };
}

export function resetChoreWasmBinding(): void {
  boundWasm = null;
}
