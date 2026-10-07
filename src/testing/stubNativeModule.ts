/** Test-only: no production module imports this. */
import { vi } from 'vitest';
import type { WatershedNativeModule } from '../systems/water/WatershedWasm';

const PLANES = 9;

/**
 * A heap-backed stand-in for `watershed_native`'s particle and chore exports:
 * JS emulations of particles.cpp / chores.cpp shapes, plus the SWE stubs a
 * grid needs. `order` records the chore calls (`op@srcPtr`).
 */
export function stubNativeModule() {
  const memory = new ArrayBuffer(1 << 18);
  const heap = new Float32Array(memory);
  const heap32 = new Int32Array(memory);
  let next = 16;
  const alloc = (count: number) => {
    const ptr = next * 4;
    next += count;
    return ptr;
  };
  const plane = (base: number, index: number, cap: number) => (base >> 2) + index * cap;
  const order: string[] = [];
  const mod = {
    HEAPF32: heap,
    HEAP32: heap32,
    getVersion: () => 11,
    allocateGrid: alloc,
    freeGrid: vi.fn(),
    stepShallowWater: vi.fn(),
    stepShallowWaterInflow: vi.fn(),
    applySWEEvent: vi.fn(),
    scrollShallowWater: vi.fn(),
    allocateParticleSoA: vi.fn((cap: number) => alloc(PLANES * cap)),
    freeParticleSoA: vi.fn(),
    initWaterfallParticles: vi.fn((base: number, cap: number, active: number, _w: number, height: number) => {
      for (let i = 0; i < active; i += 1) {
        heap[plane(base, 0, cap) + i] = i;
        heap[plane(base, 1, cap) + i] = height;
        heap[plane(base, 2, cap) + i] = -i;
        heap[plane(base, 8, cap) + i] = 0.5;
      }
      return 99;
    }),
    // Falls one unit per second; the seed counts steps.
    stepWaterfallParticles: vi.fn((base: number, cap: number, active: number, dt: number, _w: number, _h: number, _d: number, seed: number) => {
      for (let i = 0; i < active; i += 1) heap[plane(base, 1, cap) + i] -= dt;
      return seed + 1;
    }),
    // particles.cpp's splash step, in JS.
    stepSplashParticles: vi.fn((base: number, cap: number, count: number, dt: number, g: number, damp: number) => {
      const p = (k: number, i: number) => plane(base, k, cap) + i;
      for (let i = 0; i < count; i += 1) {
        for (let a = 0; a < 3; a += 1) heap[p(a, i)] += heap[p(3 + a, i)] * dt;
        heap[p(4, i)] += g * dt;
        for (let a = 3; a < 6; a += 1) heap[p(a, i)] *= damp;
        heap[p(6, i)] += dt;
        if (heap[p(6, i)] >= heap[p(7, i)]) heap[p(6, i)] = -1;
      }
    }),
    reduceF32Grid: vi.fn((src: number, count: number, out: number) => {
      order.push(`reduce@${src}`);
      const v = heap.subarray(src >> 2, (src >> 2) + count);
      heap[out >> 2] = Math.min(...v);
      heap[(out >> 2) + 1] = Math.max(...v);
      heap[(out >> 2) + 2] = v.reduce((a, b) => a + b, 0) / count;
    }),
    histogramF32: vi.fn((src: number, _count: number, _lo: number, _hi: number, bins: number) => {
      order.push(`histogram@${src}`);
      heap32[(bins >> 2) + 3] = 42;
    }),
    lumaHistogramU8: vi.fn(),
    downsampleF32: vi.fn((src: number, _sw: number, _sh: number, dst: number, dw: number, dh: number) => {
      order.push(`downsample@${src}`);
      heap.fill(2, dst >> 2, (dst >> 2) + dw * dh);
    }),
    blurSeparableF32: vi.fn((_src: number, dst: number, w: number, h: number) => {
      order.push('blur');
      heap.fill(3, dst >> 2, (dst >> 2) + w * h);
    }),
  };
  return { mod: mod as unknown as WatershedNativeModule & typeof mod, order };
}
