#!/usr/bin/env node
/**
 * swe_step_bench.mjs — stepShallowWater timing on the release binary (#467).
 *
 *   node verification/swe_step_bench.mjs                 # public/ pair, 64x40 + 96x60 + 128x80
 *   node verification/swe_step_bench.mjs --dir emscripten/build/out --sizes 64x40
 *   node verification/swe_step_bench.mjs --json out.json
 *
 * With no --sizes it measures every enabled preset's grid in
 * src/systems/water/sweQuality.ts and checks each median against
 * SWE_STEP_BUDGET_MS there (exit 1 above it). Runs in Node (same V8 wasm SIMD
 * tier as Chrome), so no browser or GPU is needed. The field is what the game steps on Ultra: a U-channel bed with dry
 * banks, a downstream current, ripples and a splash, through the routed-edge
 * step (stepShallowWaterInflow) the sim worker calls. Reports the median and
 * p95 of N timed steps after a warm-up. `pnpm profile:physics` runs it first;
 * `pnpm profile:swe` runs it alone.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const QUALITY_SOURCE = new URL('../src/systems/water/sweQuality.ts', import.meta.url);

/** Enabled preset grids and the per-step budget, read from sweQuality.ts (the one source). */
export function sweBudgetsFromSource() {
  const src = readFileSync(QUALITY_SOURCE, 'utf8');
  const budget = Number(/SWE_STEP_BUDGET_MS\s*=\s*([0-9.]+)/.exec(src)?.[1]);
  const presets = [...src.matchAll(/^\s{2}(\w+):\s*\{\s*enabled:\s*true,\s*width:\s*(\d+),\s*height:\s*(\d+)/gm)]
    .map((m) => ({ preset: m[1], size: `${m[2]}x${m[3]}` }));
  if (!Number.isFinite(budget) || presets.length === 0) {
    throw new Error('could not read SWE_BUDGETS / SWE_STEP_BUDGET_MS from sweQuality.ts');
  }
  return { budgetMs: budget, presets };
}

export async function benchSweStep({ dir = 'public', sizes = ['64x40', '96x60', '128x80'], steps = 1000, warmup = 100 } = {}) {
  const glue = await import(pathToFileURL(resolve(dir, 'watershed_native.js')).href);
  const raw = await glue.default({ wasmBinary: readFileSync(resolve(dir, 'watershed_native.wasm')) });
  const fn = (name) => raw[`_ws_${name}`] ?? raw[name];
  const alloc = fn('allocateGrid');
  const step = fn('stepShallowWaterInflow');
  const results = [];
  for (const size of sizes) {
    const [W, Hh] = size.split('x').map(Number);
    const N = W * Hh;
    const ptr = { h: alloc(N), u: alloc(N), w: alloc(N), b: alloc(N) };
    fn('reserveShallowWaterScratch')?.(W, Hh);
    const view = (p) => new Float32Array(raw.HEAPF32.buffer, p, N);
    const H = 1.0;
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const h = view(ptr.h), u = view(ptr.u), w = view(ptr.w), b = view(ptr.b);
    for (let z = 0; z < Hh; z += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = z * W + x;
        const t = Math.abs((x + 0.5) / W - 0.5) * 2; // 0 centre → 1 bank
        b[i] = 1.4 * t * t * t + 0.05 * Math.sin(z * 0.3);    // banks above H: dry
        const r = Math.hypot(x - W * 0.5, z - Hh * 0.6);
        h[i] = 0.02 * (rnd() - 0.5) + 0.25 * Math.exp(-(r * r) / 12);
        u[i] = 0.1 * (rnd() - 0.5);
        w[i] = -1.2 * (1 - t);
      }
    }
    const times = [];
    for (let k = 0; k < warmup + steps; k += 1) {
      const t0 = performance.now();
      step(ptr.h, ptr.u, ptr.w, ptr.b, W, Hh, 1 / 60, 9.80665, 0.5, H, 0.05);
      const t1 = performance.now();
      if (k >= warmup) times.push(t1 - t0);
    }
    times.sort((a, c) => a - c);
    const median = times[Math.floor(times.length / 2)];
    const p95 = times[Math.floor(times.length * 0.95)];
    let finite = true;
    for (let i = 0; i < N; i += 1) if (!Number.isFinite(h[i]) || !Number.isFinite(u[i])) finite = false;
    results.push({ size, cells: N, steps, medianMs: median, p95Ms: p95, finite });
    for (const p of Object.values(ptr)) fn('freeGrid')(p);
  }
  return results;
}

/**
 * Bench every enabled preset and hold each to SWE_STEP_BUDGET_MS. Returns
 * { ok, results }; `ok` is false when a median is over budget or a field went
 * non-finite.
 */
export async function gateSweStepBudget({ dir = 'public', steps = 1000 } = {}) {
  const { budgetMs, presets } = sweBudgetsFromSource();
  const results = await benchSweStep({ dir, sizes: [...new Set(presets.map((p) => p.size))], steps });
  let ok = true;
  for (const r of results) {
    const names = presets.filter((p) => p.size === r.size).map((p) => p.preset).join('/');
    const over = r.medianMs > budgetMs;
    if (over || !r.finite) ok = false;
    console.log(
      `[swe-step] ${names.padEnd(12)} ${r.size.padEnd(7)} median ${r.medianMs.toFixed(4)} ms  ` +
        `p95 ${r.p95Ms.toFixed(4)} ms  budget ${budgetMs} ms  ${over ? 'OVER BUDGET' : 'ok'}${r.finite ? '' : ' NON-FINITE FIELD'}`,
    );
  }
  return { ok, budgetMs, results };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const dir = opt('--dir') ?? 'public';
  const steps = Number(opt('--steps') ?? 1000);
  let output;
  if (opt('--sizes')) {
    const results = await benchSweStep({ dir, sizes: opt('--sizes').split(','), steps });
    for (const r of results) {
      console.log(`[swe-step] ${r.size.padEnd(7)} median ${r.medianMs.toFixed(4)} ms  p95 ${r.p95Ms.toFixed(4)} ms  (${r.steps} steps${r.finite ? '' : ', NON-FINITE FIELD'})`);
    }
    output = results;
  } else {
    const gate = await gateSweStepBudget({ dir, steps });
    output = gate;
    if (!gate.ok) process.exitCode = 1;
  }
  const json = opt('--json');
  if (json) writeFileSync(json, JSON.stringify(output, null, 2));
}
