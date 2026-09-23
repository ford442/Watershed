/**
 * sweParity — WGSL twin vs the C++ stepper, scenario by scenario (#435).
 *
 * Runs the committed watershed_native.wasm and swe.wgsl side by side on the
 * same fixtures and requires them to agree within 1e-5 — the tolerance
 * smoke_test.mjs holds the WASM export to against its TS twin. Also compares
 * the `sampleSWEFlow` hull samples Rapier reads, and checks the #397
 * hydroContrast margins on both backends.
 *
 * Needs a real WebGPU device, so it runs in a browser:
 * `pnpm test:wgsl` (verification/swe_wgsl_parity.mjs) serves
 * verification/swe_wgsl_parity.html and drives it in headless Chromium.
 * Never imported by the game.
 */
import { createSWEGrid, type WatershedNativeModule } from './WatershedWasm';
import { createWasmSweSim, type SweEventCall, type SweSim, type SweStepInput } from './sweSim';
import { createWgslSweSim, WGSL_SWE_MAX_EVENTS_PER_DISPATCH, type WgslSweSim } from './WgslSweSim';
import { sampleSWEFlow } from './sampleSWEFlow';
import {
  HYDRO_CONTRAST_MARGINS,
  hydroSegmentIndices,
  measureHydroHourContrastWith,
  type HydroEventApplier,
} from './hydroContrast';
import { parseHydroEvents } from './hydroEvents';
import glacial from '../../maps/glacial_source.json';
import hydro from '../../maps/hydro_dam.json';
import delta from '../../maps/delta_rapids.json';
import lumber from '../../maps/lumber_flume.json';

export const SWE_PARITY_TOLERANCE = 1e-5;
const G = 9.80665;

export interface SweParityResult {
  name: string;
  ok: boolean;
  /** Largest |wasm − wgsl| across the compared quantities. */
  maxDiff: number;
  detail: string;
}

type Fill = (x: number, z: number) => { h?: number; u?: number; w?: number; b?: number };

interface Pair {
  native: SweSim;
  gpu: WgslSweSim;
  dispose(): void;
}

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i += 1) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

export async function runSweParitySuite(
  wasm: WatershedNativeModule,
  device: GPUDevice,
): Promise<SweParityResult[]> {
  const results: SweParityResult[] = [];

  const makePair = async (width: number, height: number, dx: number, fill?: Fill): Promise<Pair> => {
    const native = createWasmSweSim(wasm, width, height, dx);
    const gpu = await createWgslSweSim(device, width, height, dx);
    for (const sim of [native, gpu]) {
      sim.h.fill(0);
      sim.u.fill(0);
      sim.w.fill(0);
      sim.b.fill(0);
      if (!fill) continue;
      for (let z = 0; z < height; z += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = z * width + x;
          const v = fill(x, z);
          if (v.h !== undefined) sim.h[i] = v.h;
          if (v.u !== undefined) sim.u[i] = v.u;
          if (v.w !== undefined) sim.w[i] = v.w;
          if (v.b !== undefined) sim.b[i] = v.b;
        }
      }
    }
    gpu.uploadField();
    return {
      native,
      gpu,
      dispose() {
        native.dispose();
        gpu.dispose();
      },
    };
  };

  const stepBoth = async (pair: Pair, steps: number, input: SweStepInput) => {
    for (let k = 0; k < steps; k += 1) {
      pair.native.step(input);
      pair.gpu.step(input);
    }
    await pair.gpu.flush();
  };

  const record = (name: string, pair: Pair, extra?: { ok: boolean; detail: string }) => {
    const diffs = {
      h: maxDiff(pair.native.h, pair.gpu.h),
      u: maxDiff(pair.native.u, pair.gpu.u),
      w: maxDiff(pair.native.w, pair.gpu.w),
      b: maxDiff(pair.native.b, pair.gpu.b),
    };
    const worst = Math.max(diffs.h, diffs.u, diffs.w, diffs.b);
    const within = worst < SWE_PARITY_TOLERANCE;
    results.push({
      name,
      ok: within && (extra?.ok ?? true),
      maxDiff: worst,
      detail:
        `h ${diffs.h.toExponential(2)} u ${diffs.u.toExponential(2)} ` +
        `w ${diffs.w.toExponential(2)} b ${diffs.b.toExponential(2)}` +
        (extra ? `; ${extra.detail}` : ''),
    });
  };

  const scenario = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      results.push({ name, ok: false, maxDiff: Number.NaN, detail: `threw: ${String(error)}` });
    }
  };

  const base = { g: G, H: 1, originX: 0, originZ: 0, events: [] as SweEventCall[] };

  await scenario('uniform flow, CFL-clamped step', async () => {
    const pair = await makePair(32, 24, 0.75, () => ({ u: 1, w: 1 }));
    await stepBoth(pair, 1, { ...base, dt: 1 });
    record('uniform flow, CFL-clamped step', pair);
    pair.dispose();
  });

  await scenario('lake at rest over a bed bump', async () => {
    const pair = await makePair(24, 16, 0.5, (x, z) => ({
      b: 0.6 * Math.exp(-((x - 12) ** 2) / 25 - ((z - 8) ** 2) / 16),
    }));
    await stepBoth(pair, 30, { ...base, dt: 0.01 });
    const maxVel = Math.max(maxDiff(pair.gpu.u, new Float32Array(pair.gpu.u.length)), maxDiff(pair.gpu.w, new Float32Array(pair.gpu.w.length)));
    record('lake at rest over a bed bump', pair, { ok: maxVel < 1e-5, detail: `wgsl max |v| ${maxVel.toExponential(2)}` });
    pair.dispose();
  });

  await scenario('dam break', async () => {
    const pair = await makePair(32, 24, 0.75, (x) => ({ h: x < 16 ? 0.5 : 0 }));
    await stepBoth(pair, 12, { ...base, dt: 0.004 });
    record('dam break', pair);
    pair.dispose();
  });

  await scenario('wetting/drying against a bank', async () => {
    const pair = await makePair(32, 24, 0.75, (x, z) => ({ b: x <= 2 ? 1.5 : 0, h: x === 10 && z === 12 ? 0.5 : 0 }));
    await stepBoth(pair, 40, { ...base, dt: 0.01 });
    record('wetting/drying against a bank', pair);
    pair.dispose();
  });

  await scenario('sampled U-channel, rest then splash', async () => {
    const pair = await makePair(32, 24, 0.75, (x) => {
      const offset = Math.abs(x - 16);
      return { b: offset > 4 ? 3 : 0.9 * (offset / 4) ** 2 };
    });
    await stepBoth(pair, 60, { ...base, dt: 0.01 });
    // The splash goes through addSurface on both — the runtime's path.
    pair.native.addSurface(12 * 32 + 16, 0.4);
    pair.gpu.addSurface(12 * 32 + 16, 0.4);
    await stepBoth(pair, 40, { ...base, dt: 0.005 });
    record('sampled U-channel, rest then splash', pair);
    pair.dispose();
  });

  await scenario('all-dry clamp', async () => {
    const pair = await makePair(8, 8, 1, () => ({ b: 3, u: 0.5 }));
    await stepBoth(pair, 2, { ...base, dt: 0.01 });
    record('all-dry clamp', pair);
    pair.dispose();
  });

  await scenario('every applySWEEvent kind, past one dispatch', async () => {
    const kinds: SweEventCall[] = [
      { kind: 0, cx: 3.5, cz: 3.5, radius: 4, strength: 8, dt: 0.05 },
      { kind: 1, cx: 10, cz: 6, radius: 5, strength: 3, dt: 0.05 },
      { kind: 2, cx: 5, cz: 10, radius: 4, strength: 1.5, dt: 0.05 },
      { kind: 3, cx: 8, cz: 8, radius: 6, strength: 4, dt: 0.05 },
    ];
    const events: SweEventCall[] = [];
    while (events.length <= WGSL_SWE_MAX_EVENTS_PER_DISPATCH + 5) events.push(...kinds);
    const pair = await makePair(16, 16, 1, () => ({ w: -1.2 }));
    await stepBoth(pair, 3, { ...base, H: 1.2, dt: 0.02, events });
    record('every applySWEEvent kind, past one dispatch', pair);
    pair.dispose();
  });

  await scenario('hull samples fed to Rapier', async () => {
    const width = 48;
    const height = 32;
    const dx = 0.5;
    const origin = { originX: -12, originZ: -8 };
    const pair = await makePair(width, height, dx, (x, z) => ({
      w: -1,
      b: 0.4 * Math.exp(-((x - 20) ** 2) / 30 - ((z - 16) ** 2) / 20),
    }));
    const events: SweEventCall[] = [
      { kind: 0, cx: 2, cz: 0, radius: 5, strength: 4, dt: 1 / 60 },
      { kind: 1, cx: -4, cz: 2, radius: 4, strength: 2, dt: 1 / 60 },
    ];
    await stepBoth(pair, 45, { ...base, ...origin, dt: 1 / 60, events });
    const flow = (sim: SweSim, worldX: number, worldZ: number) =>
      sampleSWEFlow({
        worldX,
        worldZ,
        flowSpeed: 2,
        enabled: true,
        grid: { h: sim.h, u: sim.u, w: sim.w, b: sim.b, width, height, cellSize: dx, ...origin },
      });
    let hullWorst = 0;
    for (const [x, z] of [[0, 0], [2, 0], [-4, 2], [5.3, -3.1], [-9, 5.5]]) {
      const a = flow(pair.native, x, z);
      const b = flow(pair.gpu, x, z);
      hullWorst = Math.max(
        hullWorst,
        Math.abs(a.speed - b.speed),
        Math.abs(a.dirX - b.dirX),
        Math.abs(a.dirZ - b.dirZ),
        Math.abs(a.surfaceOffset - b.surfaceOffset),
      );
    }
    record('hull samples fed to Rapier', pair, {
      ok: hullWorst < SWE_PARITY_TOLERANCE,
      detail: `hull ${hullWorst.toExponential(2)}`,
    });
    pair.dispose();
  });

  // #397 gate on both backends: the three gated maps at 06:00 vs 14:00, plus
  // lumber, whose 14:00 braid is the washout shoal.
  const appliers: Record<'wasm' | 'wgsl', HydroEventApplier> = {
    wasm(grid, calls) {
      const heap = createSWEGrid(wasm, grid.width, grid.height, grid.cellSize);
      heap.h.set(grid.h);
      heap.u.set(grid.u);
      heap.w.set(grid.w);
      heap.b.set(grid.b);
      for (const c of calls) {
        wasm.applySWEEvent(
          heap.hPtr, heap.uPtr, heap.wPtr, heap.bPtr,
          grid.width, grid.height, grid.cellSize, grid.originX, grid.originZ, grid.stillDepth,
          c.kind, c.cx, c.cz, c.radius, c.strength, c.dt,
        );
      }
      grid.h.set(heap.h);
      grid.u.set(heap.u);
      grid.w.set(heap.w);
      grid.b.set(heap.b);
      heap.dispose();
    },
    async wgsl(grid, calls) {
      const sim = await createWgslSweSim(device, grid.width, grid.height, grid.cellSize);
      sim.h.set(grid.h);
      sim.u.set(grid.u);
      sim.w.set(grid.w);
      sim.b.set(grid.b);
      sim.uploadField();
      sim.applyEvents({ H: grid.stillDepth, originX: grid.originX, originZ: grid.originZ, events: calls });
      await sim.flush();
      grid.h.set(sim.h);
      grid.u.set(sim.u);
      grid.w.set(sim.w);
      grid.b.set(sim.b);
      sim.dispose();
    },
  };
  const maps = { glacial, hydro, delta, lumber } as const;
  for (const backend of ['wasm', 'wgsl'] as const) {
    for (const [mapId, map] of Object.entries(maps)) {
      const name = `hydroContrast ${mapId} 06:00 vs 14:00 on ${backend}`;
      await scenario(name, async () => {
        const events = parseHydroEvents(map.hydroEvents);
        const failures: string[] = [];
        let meshVisible = false;
        let worstHull = Number.POSITIVE_INFINITY;
        for (const segment of hydroSegmentIndices(events)) {
          const c = await measureHydroHourContrastWith(appliers[backend], events, segment, 6, 14);
          worstHull = Math.min(worstHull, c.hullDelta);
          if (!(c.hullDelta > HYDRO_CONTRAST_MARGINS.minHullDelta)) {
            failures.push(`seg ${segment} hull ${c.hullDelta.toFixed(3)}`);
          }
          if (c.maxEtaDelta > HYDRO_CONTRAST_MARGINS.minEtaDelta || c.maxBedDelta > HYDRO_CONTRAST_MARGINS.minBedDelta) {
            meshVisible = true;
          }
        }
        if (!meshVisible) failures.push('no segment shows mesh contrast');
        results.push({
          name,
          ok: failures.length === 0,
          maxDiff: 0,
          detail: failures.length ? failures.join(', ') : `min hull delta ${worstHull.toFixed(3)}`,
        });
      });
    }
  }

  return results;
}
