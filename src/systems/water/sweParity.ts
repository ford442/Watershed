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
import type { SweInflow } from './sweScroll';
import {
  HYDRO_CONTRAST_MARGINS,
  hydroSegmentIndices,
  measureEdgeStageContrastWith,
  measureHydroHourContrastWith,
  routedEdgeEtaAt,
  type HydroEdgeContrast,
  type HydroEdgeStepper,
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

  /** Largest |wasm − wgsl| over h, u, w, b — what `record` holds to 1e-5. */
  const worstDiff = (pair: Pair) =>
    Math.max(
      maxDiff(pair.native.h, pair.gpu.h),
      maxDiff(pair.native.u, pair.gpu.u),
      maxDiff(pair.native.w, pair.gpu.w),
      maxDiff(pair.native.b, pair.gpu.b),
    );

  /** The window moved: scroll both backends the way WaterForceSystem does. */
  const scrollBoth = (pair: Pair, shiftX: number, shiftZ: number, inflow?: SweInflow) => {
    pair.native.scroll(shiftX, shiftZ, inflow);
    pair.gpu.scroll(shiftX, shiftZ, inflow);
  };

  /** The rasterizer's job: rewrite `b` from a world-space function at the new origin. */
  const rewriteBed = (
    pair: Pair,
    width: number,
    height: number,
    dx: number,
    originX: number,
    originZ: number,
    bedAt: (wx: number, wz: number) => number,
  ) => {
    for (const sim of [pair.native, pair.gpu]) {
      for (let z = 0; z < height; z += 1) {
        for (let x = 0; x < width; x += 1) sim.b[z * width + x] = bedAt(originX + x * dx, originZ + z * dx);
      }
      sim.commitBed();
    }
  };

  /** World XZ of the largest η, given the window's origin. */
  const peakWorld = (sim: SweSim, dx: number, originX: number, originZ: number) => {
    let best = -Infinity;
    let idx = 0;
    for (let i = 0; i < sim.h.length; i += 1) {
      if (sim.h[i] > best) {
        best = sim.h[i];
        idx = i;
      }
    }
    return { x: originX + (idx % sim.width) * dx, z: originZ + Math.floor(idx / sim.width) * dx, eta: best };
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

  // ── window scroll (ABI 9): the moving SWE window stays world-stable ──────────
  // Shift convention (swe.h): dst[x, z] = src[x − shiftX, z − shiftZ]; a window
  // travelling downstream (−Z) has a positive shiftZ.
  await scenario('scroll: sign, fill, bed edge extension', async () => {
    const width = 24;
    const height = 16;
    const pair = await makePair(width, height, 0.5, (x, z) => ({
      h: Math.sin(x * 0.7 + z),
      u: Math.cos(z * 0.5 + x * 0.2),
      w: 0.01 * (x + z * width),
      b: 0.3 + 0.001 * x * z,
    }));
    scrollBoth(pair, 3, -2, { eta: 0.05, u: 0.1, w: -0.2 });
    // The CPU mirror readers see before any readback lands must already agree.
    const mirror = worstDiff(pair);
    await pair.gpu.flush();
    record('scroll: sign, fill, bed edge extension', pair, {
      ok: mirror < SWE_PARITY_TOLERANCE,
      detail: `mirror before readback ${mirror.toExponential(2)}`,
    });
    pair.dispose();
  });

  await scenario('scroll: saturating and degenerate shifts', async () => {
    const width = 16;
    const height = 12;
    const pair = await makePair(width, height, 0.5, (x, z) => ({ h: 0.2 + x * 0.01, u: z * 0.1, b: 0.1 * x }));
    scrollBoth(pair, 0, 0);
    scrollBoth(pair, Number.NaN, 2);
    await pair.gpu.flush();
    const untouched = worstDiff(pair);
    scrollBoth(pair, width, 0, { eta: 0.1, u: 0, w: 0 });
    scrollBoth(pair, 1e9, -1e9);
    await pair.gpu.flush();
    const allRest = pair.gpu.h.every((v) => v === 0) && pair.native.h.every((v) => v === 0);
    record('scroll: saturating and degenerate shifts', pair, {
      ok: allRest && untouched < SWE_PARITY_TOLERANCE,
      detail: `no-op ${untouched.toExponential(2)}, saturated field at rest ${allRest}`,
    });
    pair.dispose();
  });

  await scenario('scroll + bed rewrite + steps, readback in flight across each scroll', async () => {
    const width = 48;
    const height = 32;
    const dx = 0.5;
    const bedAt = (wx: number, wz: number) => 0.4 + 0.3 * Math.sin(0.3 * wx + 0.2 * wz);
    const bump = { x: 24 * dx, z: 12 * dx };
    const pair = await makePair(width, height, dx, (x, z) => ({
      h: 0.3 * Math.exp(-((x * dx - bump.x) ** 2 + (z * dx - bump.z) ** 2) / 1.5),
      b: bedAt(x * dx, z * dx),
    }));
    let cellX = 0;
    let cellZ = 0;
    // The vehicle mostly runs downstream (+shiftZ), drifting across the channel.
    for (const [shiftX, shiftZ] of [[-2, 0], [0, 3], [-1, 2], [2, -1], [0, 4], [-3, 0]]) {
      cellX -= shiftX;
      cellZ -= shiftZ;
      scrollBoth(pair, shiftX, shiftZ);
      rewriteBed(pair, width, height, dx, cellX * dx, cellZ * dx, bedAt);
      // No flush: the GPU readback started by these steps is still in flight when
      // the next scroll lands, and must be dropped rather than mirrored.
      for (let k = 0; k < 3; k += 1) {
        pair.native.step({ ...base, dt: 0.01, originX: cellX * dx, originZ: cellZ * dx });
        pair.gpu.step({ ...base, dt: 0.01, originX: cellX * dx, originZ: cellZ * dx });
      }
    }
    await pair.gpu.flush();
    const a = peakWorld(pair.native, dx, cellX * dx, cellZ * dx);
    const g = peakWorld(pair.gpu, dx, cellX * dx, cellZ * dx);
    // The splash spreads but does not travel: its peak stays at its world cell
    // while the window has moved 5 columns and 8 rows, identically on both.
    const held = Math.abs(a.x - bump.x) <= 2 * dx && Math.abs(a.z - bump.z) <= 2 * dx && a.eta > 0.02;
    const same = a.x === g.x && a.z === g.z;
    record('scroll + bed rewrite + steps, readback in flight across each scroll', pair, {
      ok: held && same,
      detail: `window moved (${cellX}, ${cellZ}) cells; peak wasm (${a.x}, ${a.z}) wgsl (${g.x}, ${g.z}) vs world (${bump.x}, ${bump.z})`,
    });
    pair.dispose();
  });

  await scenario('scroll: a readback taken before the scroll is never mirrored into the new frame', async () => {
    const width = 32;
    const height = 24;
    // A dry field is invariant under a step (every cell pins η to b − H), yet
    // its η pattern is position-dependent — so the wasm field and the WGSL
    // mirror stay comparable mid-flight, and a stale-frame mirror shows up.
    const bedAt = (x: number, z: number) => 2 + 0.1 * x + 0.05 * z;
    const pair = await makePair(width, height, 0.75, (x, z) => ({ b: bedAt(x, z), h: bedAt(x, z) - 1 }));
    pair.native.step({ ...base, dt: 0.01 });
    pair.gpu.step({ ...base, dt: 0.01 }); // its readback starts now, in the pre-scroll frame
    scrollBoth(pair, 3, -2);
    // Let that readback land. Nothing else is submitted, so nothing refreshes
    // the mirror behind it: whatever it holds now is what a reader would see.
    await device.queue.onSubmittedWorkDone();
    await new Promise((resolve) => setTimeout(resolve, 300));
    record('scroll: a readback taken before the scroll is never mirrored into the new frame', pair);
    await pair.gpu.flush();
    record('scroll: ...and the next readback brings the same field', pair);
    pair.dispose();
  });

  await scenario('scroll: queued splash lands in the old frame, then moves with the world', async () => {
    const width = 32;
    const height = 24;
    const pair = await makePair(width, height, 0.75, () => ({}));
    // Queued, not stepped: WASM adds to η at once, WGSL folds the delta in
    // before the scroll — both address the frame the caller computed it in.
    pair.native.addSurface(12 * width + 16, 0.4);
    pair.gpu.addSurface(12 * width + 16, 0.4);
    scrollBoth(pair, -2, 3);
    for (let k = 0; k < 10; k += 1) {
      pair.native.step({ ...base, dt: 0.01 });
      pair.gpu.step({ ...base, dt: 0.01 });
    }
    await pair.gpu.flush();
    record('scroll: queued splash lands in the old frame, then moves with the world', pair);
    pair.dispose();
  });

  await scenario('scroll: a splash leaving the upstream edge is dropped, not wrapped', async () => {
    const width = 32;
    const height = 24;
    const pair = await makePair(width, height, 0.75, (x, z) => ({ h: x === 10 && z === height - 3 ? 0.5 : 0 }));
    scrollBoth(pair, 0, 3);
    await pair.gpu.flush();
    const gone = pair.gpu.h.every((v) => v === 0) && pair.native.h.every((v) => v === 0);
    record('scroll: a splash leaving the upstream edge is dropped, not wrapped', pair, {
      ok: gone,
      detail: `field at rest on both: ${gone}`,
    });
    pair.dispose();
  });

  // Routed upstream edge (ABI 10): stepShallowWaterInflow vs swe.wgsl with
  // edgeActive. The edge stage is one routed number; both backends must turn
  // it into the same field.
  await scenario('routed edge: reference stage over a bumpy, partly dry bed', async () => {
    const pair = await makePair(24, 16, 0.5, (x, z) => {
      const b = x < 2 ? 1.6 : 1.3 * Math.exp(-((x - 12) ** 2) / 20 - ((z - 15) ** 2) / 12);
      return { b, h: b > 1 ? b - 1 : 0 };
    });
    await stepBoth(pair, 60, { ...base, dt: 1 / 60, edgeEta: 0 });
    const zero = new Float32Array(pair.gpu.u.length);
    const maxVel = Math.max(maxDiff(pair.gpu.u, zero), maxDiff(pair.gpu.w, zero));
    record('routed edge: reference stage over a bumpy, partly dry bed', pair, {
      ok: maxVel < 1e-5,
      detail: `wgsl max |v| ${maxVel.toExponential(2)}`,
    });
    pair.dispose();
  });

  await scenario('routed edge: a raised stage enters upstream and runs downstream', async () => {
    const pair = await makePair(32, 24, 0.75);
    await stepBoth(pair, 45, { ...base, dt: 1 / 60, edgeEta: 0.38 });
    const top = 23 * 32 + 16;
    const entered = pair.gpu.h[top] > 0.19 && pair.gpu.w[top] < 0 && Math.abs(pair.gpu.h[16]) < 1e-4;
    record('routed edge: a raised stage enters upstream and runs downstream', pair, {
      ok: entered,
      detail: `top η ${pair.gpu.h[top].toFixed(4)} w ${pair.gpu.w[top].toFixed(4)}`,
    });
    pair.dispose();
  });

  await scenario('routed edge: sampled U-channel with dry banks, splash leaving upstream', async () => {
    const pair = await makePair(32, 24, 0.75, (x, z) => {
      const off = Math.abs(x - 16);
      const b = off > 9 ? 1.4 : 0.9 * (off / 9) ** 2;
      return { b, h: (b > 1 ? b - 1 : 0) + (off < 4 && Math.abs(z - 20) < 3 ? 0.2 : 0) };
    });
    await stepBoth(pair, 90, { ...base, dt: 1 / 60, edgeEta: 0.25 });
    record('routed edge: sampled U-channel with dry banks, splash leaving upstream', pair);
    pair.dispose();
  });

  // #397 gate through the boundary: hydro 06:00 vs 14:00 with no hydroEvents,
  // only the routed edge, on both backends, and the two must agree.
  const edgeSteppers: Record<'wasm' | 'wgsl', HydroEdgeStepper> = {
    wasm(grid, edgeEta, steps, dt) {
      const sim = createWasmSweSim(wasm, grid.width, grid.height, grid.cellSize);
      sim.h.set(grid.h);
      sim.u.set(grid.u);
      sim.w.set(grid.w);
      sim.b.set(grid.b);
      for (let k = 0; k < steps; k += 1) {
        sim.step({ dt, g: G, H: grid.stillDepth, originX: grid.originX, originZ: grid.originZ, events: [], edgeEta });
      }
      grid.h.set(sim.h);
      grid.u.set(sim.u);
      grid.w.set(sim.w);
      sim.dispose();
    },
    async wgsl(grid, edgeEta, steps, dt) {
      const sim = await createWgslSweSim(device, grid.width, grid.height, grid.cellSize);
      sim.h.set(grid.h);
      sim.u.set(grid.u);
      sim.w.set(grid.w);
      sim.b.set(grid.b);
      sim.uploadField();
      for (let k = 0; k < steps; k += 1) {
        sim.step({ dt, g: G, H: grid.stillDepth, originX: grid.originX, originZ: grid.originZ, events: [], edgeEta });
      }
      await sim.flush();
      grid.h.set(sim.h);
      grid.u.set(sim.u);
      grid.w.set(sim.w);
      sim.dispose();
    },
  };
  await scenario('routed edge: hydro 06:00 vs 14:00 through the boundary, both backends', async () => {
    const scout = routedEdgeEtaAt(wasm, 'hydro', 4, 6);
    const dam = routedEdgeEtaAt(wasm, 'hydro', 4, 14);
    const byBackend: Partial<Record<'wasm' | 'wgsl', HydroEdgeContrast>> = {};
    const failures: string[] = [];
    for (const backend of ['wasm', 'wgsl'] as const) {
      const c = await measureEdgeStageContrastWith(edgeSteppers[backend], scout, dam);
      byBackend[backend] = c;
      if (!(c.maxEtaDelta > HYDRO_CONTRAST_MARGINS.minEtaDelta)) failures.push(`${backend} mesh ${c.maxEtaDelta.toFixed(3)}`);
      if (!(c.hullDelta > HYDRO_CONTRAST_MARGINS.minHullDelta)) failures.push(`${backend} hull ${c.hullDelta.toFixed(3)}`);
    }
    const a = byBackend.wasm!;
    const b = byBackend.wgsl!;
    const disagree = Math.max(
      Math.abs(a.maxEtaDelta - b.maxEtaDelta),
      Math.abs(a.hullStageDelta - b.hullStageDelta),
      Math.abs(a.hullSpeedDelta - b.hullSpeedDelta),
    );
    if (!(disagree < SWE_PARITY_TOLERANCE)) failures.push(`backends disagree by ${disagree.toExponential(2)}`);
    results.push({
      name: 'routed edge: hydro 06:00 vs 14:00 through the boundary, both backends',
      ok: failures.length === 0,
      maxDiff: disagree,
      detail: failures.length
        ? failures.join(', ')
        : `edge η ${scout.toFixed(3)} → ${dam.toFixed(3)}, mesh Δη ${a.maxEtaDelta.toFixed(3)}, hull ${a.hullDelta.toFixed(3)}`,
    });
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
