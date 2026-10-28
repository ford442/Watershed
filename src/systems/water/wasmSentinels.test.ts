// @vitest-environment node
/**
 * wasmSentinels.test.ts — the documented sentinels hold through the real wasm (#502 A).
 *
 * Every ws_* entry point returns early, writing nothing, on a null pointer or a
 * non-positive / oversized extent (WASM.md "Untrusted-input sentinels"). In
 * wasm, address 0 is writable, so a missing guard is silent corruption of low
 * memory, not a crash; each case below therefore checks a canary plane AND the
 * first bytes of the heap. One block per TU. Runs on the committed pair, so
 * `pnpm test` (no Emscripten) checks the binary that ships.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { WatershedNativeModule } from './wasmAbi';
import { loadNativeFromDisk } from '../../testing/nativeFromDisk';

const CANARY = 7;
const SWE_MAX_GRID_EXTENT = 4096;
const WS_MAX_ELEMENTS = SWE_MAX_GRID_EXTENT * SWE_MAX_GRID_EXTENT;
const WATER_FORCE_MAX_SAMPLES = 1 << 16;
const ROUTING_MAX_SEGMENTS = 1 << 16;
const PARTICLE_MAX_CAPACITY = 1 << 20;

let wasm: WatershedNativeModule;

/** A canary plane of `floats` in the heap; `untouched()` re-reads it through the live heap. */
function canary(floats: number) {
  const ptr = wasm.allocateGrid(floats);
  const view = () => new Float32Array(wasm.HEAPF32.buffer, ptr, floats);
  view().fill(CANARY);
  return {
    ptr,
    view,
    untouched: () => view().every((v) => v === CANARY),
    free: () => wasm.freeGrid(ptr),
  };
}

/** Low memory: what a write through a null out-pointer would hit. */
function lowMemory(): Uint8Array {
  return wasm.HEAPU8.slice(0, 1024);
}

beforeAll(async () => {
  wasm = await loadNativeFromDisk();
});

describe('chores.cpp', () => {
  it('reduce / histograms reject null, negative and oversized counts', () => {
    const src = canary(16);
    const out = canary(256);
    const low = lowMemory();
    wasm.reduceF32Grid(src.ptr, 4, 0);
    wasm.reduceF32Grid(0, 4, out.ptr);
    wasm.reduceF32Grid(src.ptr, -1, out.ptr);
    wasm.reduceF32Grid(src.ptr, WS_MAX_ELEMENTS + 1, out.ptr);
    wasm.histogramF32(src.ptr, 4, 0, 1, 0);
    wasm.histogramF32(0, 4, 0, 1, out.ptr);
    wasm.histogramF32(src.ptr, -3, 0, 1, out.ptr);
    wasm.lumaHistogramU8(src.ptr, 4, 0);
    wasm.lumaHistogramU8(src.ptr, -1, out.ptr);
    wasm.lumaHistogramU8(src.ptr, WS_MAX_ELEMENTS + 1, out.ptr);
    expect(out.untouched()).toBe(true);
    expect(lowMemory()).toEqual(low);
    // A count of 0 is a valid empty grid: zeros.
    wasm.reduceF32Grid(0, 0, out.ptr);
    expect([...out.view().subarray(0, 4)]).toEqual([0, 0, 0, CANARY]);
    src.free();
    out.free();
  });

  it('downsample / blur reject null and non-positive or oversized extents', () => {
    const src = canary(16);
    const dst = canary(16);
    const low = lowMemory();
    wasm.downsampleF32(0, 4, 4, dst.ptr, 2, 2);
    wasm.downsampleF32(src.ptr, 4, 4, 0, 2, 2);
    wasm.downsampleF32(src.ptr, -4, 4, dst.ptr, 2, 2);
    wasm.downsampleF32(src.ptr, 4, 0, dst.ptr, 2, 2);
    wasm.downsampleF32(src.ptr, SWE_MAX_GRID_EXTENT + 1, 1, dst.ptr, 2, 2);
    wasm.blurSeparableF32(0, dst.ptr, 4, 4);
    wasm.blurSeparableF32(src.ptr, 0, 4, 4);
    // Before #502 this wrapped size_t, failed malloc and memcpy'd past the heap.
    wasm.blurSeparableF32(src.ptr, dst.ptr, -4, 4);
    wasm.blurSeparableF32(src.ptr, dst.ptr, 4, 0);
    expect(dst.untouched()).toBe(true);
    expect(lowMemory()).toEqual(low);
    src.free();
    dst.free();
  });
});

describe('swe.cpp', () => {
  it('step / inflow step / event / scroll reject null planes and bad extents', () => {
    const h = canary(16);
    const u = canary(16);
    const w = canary(16);
    const low = lowMemory();
    wasm.stepShallowWater(0, u.ptr, w.ptr, 0, 4, 4, 0.01, 9.8, 0.5, 1);
    wasm.stepShallowWater(h.ptr, u.ptr, w.ptr, 0, -4, 4, 0.01, 9.8, 0.5, 1);
    wasm.stepShallowWater(h.ptr, u.ptr, w.ptr, 0, SWE_MAX_GRID_EXTENT + 1, 1, 0.01, 9.8, 0.5, 1);
    wasm.stepShallowWaterInflow(h.ptr, 0, w.ptr, 0, 4, 4, 0.01, 9.8, 0.5, 1, 0.2);
    wasm.applySWEEvent(h.ptr, u.ptr, 0, 0, 4, 4, 0.5, 0, 0, 1, 0, 1, 1, 2, 1, 0.1);
    wasm.applySWEEvent(h.ptr, u.ptr, w.ptr, 0, 0, 4, 0.5, 0, 0, 1, 0, 1, 1, 2, 1, 0.1);
    wasm.scrollShallowWater(h.ptr, u.ptr, w.ptr, 0, 4, -4, 1, 1, 0, 0, 0);
    wasm.scrollShallowWater(0, u.ptr, w.ptr, 0, 4, 4, 1, 1, 0, 0, 0);
    expect(h.untouched() && u.untouched() && w.untouched()).toBe(true);
    expect(lowMemory()).toEqual(low);
    expect(wasm.allocateGrid(0)).toBe(0);
    for (const c of [h, u, w]) c.free();
  });
});

describe('non-finite scalars', () => {
  // `dt <= 0` is false for NaN, and std::max(x, 0) returns a NaN x: before
  // these guards one NaN dt made every SWE cell NaN for the session, and one
  // NaN head discharge did the same to the routed chain.
  it('a NaN / inf dt, g, dx or H leaves the SWE field finite and unchanged', () => {
    const n = 8 * 8;
    const h = canary(n);
    const u = canary(n);
    const w = canary(n);
    h.view().fill(0.05);
    u.view().fill(0.5);
    w.view().fill(-0.25);
    const before = [...h.view()];
    for (const dt of [Number.NaN, -Number.NaN]) {
      wasm.stepShallowWater(h.ptr, u.ptr, w.ptr, 0, 8, 8, dt, 9.8, 0.5, 1);
      wasm.stepShallowWaterInflow(h.ptr, u.ptr, w.ptr, 0, 8, 8, dt, 9.8, 0.5, 1, 0.2);
    }
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      wasm.stepShallowWater(h.ptr, u.ptr, w.ptr, 0, 8, 8, 0.01, bad, 0.5, 1);
      wasm.stepShallowWater(h.ptr, u.ptr, w.ptr, 0, 8, 8, 0.01, 9.8, bad, 1);
      wasm.stepShallowWater(h.ptr, u.ptr, w.ptr, 0, 8, 8, 0.01, 9.8, 0.5, bad);
      wasm.applySWEEvent(h.ptr, u.ptr, w.ptr, 0, 8, 8, 0.5, 0, 0, 1, 0, 2, 2, 1, Number.POSITIVE_INFINITY, 0.1);
    }
    expect([...h.view()]).toEqual(before);
    wasm.scrollShallowWater(h.ptr, u.ptr, w.ptr, 0, 8, 8, 1, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NaN);
    wasm.stepShallowWater(h.ptr, u.ptr, w.ptr, 0, 8, 8, Number.POSITIVE_INFINITY, 9.8, 0.5, 1);
    for (const c of [h, u, w]) expect(c.view().every(Number.isFinite)).toBe(true);
    for (const c of [h, u, w]) c.free();
  });

  it('a NaN / inf head discharge, dt or length leaves the routed chain finite', () => {
    const nSeg = 3;
    const lengths = canary(nSeg);
    const slopes = canary(nSeg);
    const widths = canary(nSeg);
    const storage = canary(nSeg * 4);
    const outflow = canary(nSeg);
    lengths.view().fill(100);
    slopes.view().fill(0.01);
    widths.view().fill(12);
    wasm.routeReachSteady(lengths.ptr, slopes.ptr, widths.ptr, nSeg, 5, storage.ptr, outflow.ptr);
    wasm.routeReach(lengths.ptr, slopes.ptr, widths.ptr, nSeg, Number.NaN, 1, storage.ptr, outflow.ptr);
    wasm.routeReach(lengths.ptr, slopes.ptr, widths.ptr, nSeg, Number.POSITIVE_INFINITY, 1, storage.ptr, outflow.ptr);
    wasm.routeReach(lengths.ptr, slopes.ptr, widths.ptr, nSeg, 5, Number.NaN, storage.ptr, outflow.ptr);
    wasm.routeReach(lengths.ptr, slopes.ptr, widths.ptr, nSeg, 5, 1e-40, storage.ptr, outflow.ptr);
    lengths.view()[1] = Number.NaN;
    wasm.routeReach(lengths.ptr, slopes.ptr, widths.ptr, nSeg, 5, 1, storage.ptr, outflow.ptr);
    expect(storage.view().every(Number.isFinite)).toBe(true);
    expect(outflow.view().every(Number.isFinite)).toBe(true);
    for (const c of [lengths, slopes, widths, storage, outflow]) c.free();
  });
});

describe('forces.cpp', () => {
  it('the batch rejects null buffers and negative / oversized counts', () => {
    const io = canary(64);
    const low = lowMemory();
    const args = [4.5, 0.5, 150, 1.2, 0.47, 1.05, 0.7, 0, 0, 2.4] as const;
    wasm.computeWaterForcesBatch(0, io.ptr, 2, ...args);
    wasm.computeWaterForcesBatch(io.ptr, 0, 2, ...args);
    wasm.computeWaterForcesBatch(io.ptr, io.ptr, -1, ...args);
    wasm.computeWaterForcesBatch(io.ptr, io.ptr, WATER_FORCE_MAX_SAMPLES + 1, ...args);
    expect(io.untouched()).toBe(true);
    expect(lowMemory()).toEqual(low);
    io.free();
  });
});

describe('routing.cpp', () => {
  it('route / lateral route / steady / travel time reject null planes and bad chain lengths', () => {
    const plane = canary(64);
    const low = lowMemory();
    wasm.routeReach(plane.ptr, plane.ptr, plane.ptr, 4, 1, 1, 0, plane.ptr);
    wasm.routeReach(plane.ptr, plane.ptr, plane.ptr, -2, 1, 1, plane.ptr, plane.ptr);
    wasm.routeReach(plane.ptr, plane.ptr, plane.ptr, ROUTING_MAX_SEGMENTS + 1, 1, 1, plane.ptr, plane.ptr);
    wasm.routeReachLateral(plane.ptr, plane.ptr, plane.ptr, 4, 1, plane.ptr, 1, 0, plane.ptr);
    wasm.routeReachLateral(plane.ptr, plane.ptr, plane.ptr, -2, 1, plane.ptr, 1, plane.ptr, plane.ptr);
    wasm.routeReachSteady(plane.ptr, 0, plane.ptr, 4, 1, plane.ptr, plane.ptr);
    wasm.routeReachSteady(plane.ptr, plane.ptr, plane.ptr, ROUTING_MAX_SEGMENTS + 1, 1, plane.ptr, plane.ptr);
    wasm.routeReachTravelTime(plane.ptr, plane.ptr, plane.ptr, 4, 1, 0);
    wasm.routeReachTravelTime(plane.ptr, plane.ptr, plane.ptr, 0, 1, plane.ptr);
    expect(plane.untouched()).toBe(true);
    expect(lowMemory()).toEqual(low);
    expect(wasm.routedEdgeState(Number.NaN, 40, 1, 9.8)).toEqual({ eta: 0, speed: 0 });
    plane.free();
  });
});

describe('particles.cpp', () => {
  it('alloc returns 0 and steps write nothing for bad capacities', () => {
    const soa = canary(64);
    const low = lowMemory();
    expect(wasm.allocateParticleSoA(0)).toBe(0);
    expect(wasm.allocateParticleSoA(-1)).toBe(0);
    expect(wasm.allocateParticleSoA(PARTICLE_MAX_CAPACITY + 1)).toBe(0);
    expect(wasm.initWaterfallParticles(0, 4, 4, 1, 1, 1, 0, 42)).toBe(42);
    expect(wasm.stepWaterfallParticles(soa.ptr, PARTICLE_MAX_CAPACITY + 1, 4, 0.1, 1, 1, 1, 42)).toBe(42);
    expect(wasm.stepWaterfallParticles(soa.ptr, -4, 4, 0.1, 1, 1, 1, 42)).toBe(42);
    wasm.stepSplashParticles(0, 4, 4, 0.1, -9.8, 0.99);
    wasm.stepSplashParticles(soa.ptr, 0, 4, 0.1, -9.8, 0.99);
    expect(soa.untouched()).toBe(true);
    expect(lowMemory()).toEqual(low);
    soa.free();
  });
});

describe('terrain.cpp', () => {
  it('tile / wall shell return 0 and write nothing for null outputs and bad grids', () => {
    const out = canary(7 * 9);
    const low = lowMemory();
    expect(wasm.buildTerrainTile(10, 30, 10, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0)).toBe(0);
    expect(wasm.buildTerrainTile(10, 30, 10, 0, 2, 0, 0, 0, 0, 0, 0, 0, out.ptr)).toBe(0);
    expect(wasm.buildTerrainTile(10, 30, 10, -2, 2, 0, 0, 0, 0, 0, 0, 0, out.ptr)).toBe(0);
    expect(wasm.buildTerrainTile(10, 30, 10, 2, 2, 0, 0, 0, 0, 0, 0, 3, out.ptr)).toBe(0);
    expect(wasm.buildTerrainTile(Number.NaN, 30, 10, 2, 2, 0, 0, 0, 0, 0, 0, 0, out.ptr)).toBe(0);
    expect(wasm.buildWallShell(10, 30, 2, 2, 0, 20, 1, 0)).toBe(0);
    expect(wasm.buildWallShell(10, 30, 2, -1, 0, 20, 1, out.ptr)).toBe(0);
    expect(out.untouched()).toBe(true);
    expect(lowMemory()).toEqual(low);
    expect(wasm.buildTerrainTile(10, 30, 10, 2, 2, 0, 0, 0, 0, 0, 0, 0, out.ptr)).toBe(9);
    out.free();
  });
});
