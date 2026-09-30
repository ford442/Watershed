/**
 * sweScroll.integration.test.ts — the scroll export of the REAL watershed_native
 * binary, driven from TypeScript the way WaterForceSystem drives it.
 *
 * Gated like WatershedWasm.integration.test.ts (`pnpm test:wasm`): it needs the
 * compiled module. The Node smoke script covers the raw kernel; this covers the
 * TS side — createWasmSweSim's export path, advanceSweWindow's shifts, and that
 * the binary and the TypeScript twin (`scrollField`, which the WGSL mirror and an
 * ABI-8 fallback rely on) move the field identically.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SWE_BUDGETS } from './sweQuality';
import { advanceSweWindow, scrollField, type SweWindow } from './sweScroll';
import { createWasmSweSim } from './sweSim';
import { createSWEGrid, type WatershedNativeModule } from './WatershedWasm';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');
const wasmPath = resolve(publicDir, 'watershed_native.wasm');
const jsPath = resolve(publicDir, 'watershed_native.js');
const runIntegration = process.env.WATERSHED_WASM_INTEGRATION === '1' && existsSync(wasmPath);
const describeIntegration = runIntegration ? describe : describe.skip;

async function loadModule(): Promise<WatershedNativeModule> {
  const wasmBinary = readFileSync(wasmPath);
  const { default: create } = await import(/* @vite-ignore */ pathToFileURL(jsPath).href);
  return create({
    instantiateWasm: (
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance) => void,
    ) => {
      WebAssembly.instantiate(wasmBinary, imports).then(({ instance }) => receive(instance));
      return {};
    },
  });
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describeIntegration('scrollShallowWater — real binary, driven from TypeScript', () => {
  let wasm: WatershedNativeModule;

  beforeAll(async () => {
    wasm = await loadModule();
  });

  it('is ABI 9 and exports the scroll', () => {
    expect(wasm.getVersion()).toBeGreaterThanOrEqual(9);
    expect(typeof wasm.scrollShallowWater).toBe('function');
  });

  it('moves the field bit-for-bit like the TypeScript twin (WGSL mirror / fallback)', () => {
    const rand = mulberry32(42);
    for (const [width, height] of [[16, 12], [32, 24], [48, 32]] as const) {
      const grid = createSWEGrid(wasm, width, height, 0.5);
      const twin = {
        h: new Float32Array(width * height),
        u: new Float32Array(width * height),
        w: new Float32Array(width * height),
        b: new Float32Array(width * height),
      };
      for (let trial = 0; trial < 40; trial += 1) {
        for (const key of ['h', 'u', 'w', 'b'] as const) {
          const plane = grid[key];
          for (let i = 0; i < plane.length; i += 1) plane[i] = (rand() - 0.5) * 4;
          twin[key].set(plane);
        }
        const span = trial % 5 === 0 ? 3 * width : 6;
        const shiftX = Math.round((rand() - 0.5) * 2 * span);
        const shiftZ = Math.round((rand() - 0.5) * 2 * span);
        const inflow = { eta: rand() - 0.5, u: rand() - 0.5, w: rand() - 0.5 };

        wasm.scrollShallowWater!(
          grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr,
          width, height, shiftX, shiftZ, inflow.eta, inflow.u, inflow.w,
        );
        scrollField(twin, width, height, shiftX, shiftZ, inflow);

        for (const key of ['h', 'u', 'w', 'b'] as const) {
          expect(Array.from(grid[key]), `${key} ${width}x${height} shift (${shiftX}, ${shiftZ})`).toEqual(
            Array.from(twin[key]),
          );
        }
      }
      grid.dispose();
    }
  });

  it('keeps a Gaussian splash on its world XZ while the vehicle moves several cells, solver stepping', () => {
    const budget = SWE_BUDGETS.high;
    const { width, height, cellSize } = budget;
    const scrollSpy = vi.spyOn(wasm as Required<WatershedNativeModule>, 'scrollShallowWater');
    const moving = createWasmSweSim(wasm, width, height, cellSize);
    const fixed = createWasmSweSim(wasm, width, height, cellSize);

    // Vehicle at the origin; both windows start on the same lattice cell.
    let window: SweWindow = advanceSweWindow(null, 0, 0, budget)!.window;
    const anchorWindow = window;
    const bumpWorld = { x: window.originX + 24 * cellSize, z: window.originZ + 16 * cellSize };
    for (const sim of [moving, fixed]) {
      for (let j = 0; j < height; j += 1) {
        for (let i = 0; i < width; i += 1) {
          const dx = anchorWindow.originX + i * cellSize - bumpWorld.x;
          const dz = anchorWindow.originZ + j * cellSize - bumpWorld.z;
          sim.h[j * width + i] = 0.3 * Math.exp(-(dx * dx + dz * dz) / 1.5);
        }
      }
    }

    // 24 frames: 0.1 m sideways and 0.15 m downstream per frame → 2.4 m (≈5
    // cells) and 3.6 m (≈7 cells) of window travel, none of it in one frame.
    const base = { dt: 0.01, g: 9.80665, H: 1, events: [] };
    for (let f = 1; f <= 24; f += 1) {
      const step = advanceSweWindow(window, 0.1 * f, -0.15 * f, budget)!;
      if (step.shiftX !== 0 || step.shiftZ !== 0) moving.scroll(step.shiftX, step.shiftZ);
      window = step.window;
      // Beds are flat and world-fixed here, so the rasterizer's rewrite is a no-op.
      moving.step({ ...base, originX: window.originX, originZ: window.originZ });
      fixed.step({ ...base, originX: anchorWindow.originX, originZ: anchorWindow.originZ });
    }

    const cellsX = window.cellX - anchorWindow.cellX;
    const cellsZ = window.cellZ - anchorWindow.cellZ;
    expect(cellsX).toBeGreaterThanOrEqual(4);
    expect(cellsZ).toBeLessThanOrEqual(-6);
    expect(scrollSpy).toHaveBeenCalled(); // the export, not the TS fallback

    // World cell (i, j) of the moving window is (i + cellsX, j + cellsZ) of the fixed one.
    let worst = 0;
    let peak = 0;
    let peakWorld = { x: Number.NaN, z: Number.NaN };
    const margin = 5;
    for (let j = margin; j < height - margin; j += 1) {
      for (let i = margin; i < width - margin; i += 1) {
        const fi = i + cellsX;
        const fj = j + cellsZ;
        if (fi < margin || fi >= width - margin || fj < margin || fj >= height - margin) continue;
        const m = j * width + i;
        const r = fj * width + fi;
        worst = Math.max(worst, Math.abs(moving.h[m] - fixed.h[r]), Math.abs(moving.u[m] - fixed.u[r]), Math.abs(moving.w[m] - fixed.w[r]));
        if (moving.h[m] > peak) {
          peak = moving.h[m];
          peakWorld = { x: window.originX + i * cellSize, z: window.originZ + j * cellSize };
        }
      }
    }
    expect(peak).toBeGreaterThan(0.02);
    // The splash spreads symmetrically but does not travel: its peak stays at
    // its world cell (±1) while the window has moved ~5 and ~7 cells.
    expect(Math.abs(peakWorld.x - bumpWorld.x)).toBeLessThanOrEqual(cellSize + 1e-9);
    expect(Math.abs(peakWorld.z - bumpWorld.z)).toBeLessThanOrEqual(cellSize + 1e-9);
    // And the scrolled window evolves it the same as a window that never moved.
    expect(worst).toBeLessThan(1e-5);

    scrollSpy.mockRestore();
    moving.dispose();
    fixed.dispose();
  });

  it('drops a splash that scrolls off the upstream edge — no wrap', () => {
    const budget = SWE_BUDGETS.medium;
    const { width, height, cellSize } = budget;
    const sim = createWasmSweSim(wasm, width, height, cellSize);
    sim.h[(height - 3) * width + 10] = 0.5; // 3 rows from the upstream (high-row) edge
    sim.scroll(0, 3); // window travels 3 cells downstream
    expect(Array.from(sim.h).every((v) => v === 0)).toBe(true);
    sim.dispose();
  });
});
