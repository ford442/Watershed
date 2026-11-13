/**
 * perfBaseline.mjs — compare a run's timings with a committed baseline (#559 E).
 *
 * Shared by perf_trace_smoke.mjs (the scripted meander's trace spans) and
 * perf_compare.mjs (`pnpm profile:swe` / `profile:spawn` reports). A metric is
 * `{ n, p50, p95 }` in ms under a key like `main/sim-step`.
 *
 * Boxes differ, so every run also times a fixed JS workload (`calibrate`) and
 * the gate compares p95 / calibration — "how many calibration units a sim step
 * costs" — which moves far less between a laptop and a CI runner than raw ms.
 * The raw numbers are printed beside it.
 *
 * A gated metric fails when its normalised p95 is more than `maxRegression`
 * above the baseline's AND the raw p95 grew by more than `floorMs` (a 20 % rise
 * on a 30 µs span is noise, not a regression). Ungated metrics are reported.
 *
 * Files (verification/perf-baselines/):
 *   <name>.json      { calibrationMs, metrics: { key: { n, p50, p95 } }, recordedAt, note }
 *   tolerance.json   { default: { maxRegression, floorMs }, suites: { <name>: { gated: { key: {…overrides} } } } }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'perf-baselines');

export function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

export const round = (v, d = 4) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);

/**
 * The calibration workload, as source so a page can `evaluate` the same text
 * (perf_trace_smoke.mjs) that Node runs (perf_compare.mjs). Float math and
 * array traffic, roughly the shape of a sim step; returns median ms of `reps`.
 */
export const CALIBRATE_SOURCE = `(reps) => {
  const n = 1 << 16;
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i += 1) { a[i] = (i % 97) * 0.01; b[i] = (i % 89) * 0.02; }
  const times = [];
  let sink = 0;
  for (let r = 0; r < reps + 3; r += 1) {
    const t0 = performance.now();
    for (let pass = 0; pass < 24; pass += 1) {
      for (let i = 1; i < n - 1; i += 1) {
        const v = a[i] * 0.98 + (b[i - 1] + b[i + 1]) * 0.01 + Math.sqrt(a[i] * a[i] + 1);
        b[i] = v * 0.5;
        sink += v;
      }
    }
    const dt = performance.now() - t0;
    if (r >= 3) times.push(dt);
  }
  times.sort((x, y) => x - y);
  return { ms: times[Math.floor(times.length / 2)], sink };
}`;

export function calibrateNode(reps = 15) {
  const fn = new Function(`return ${CALIBRATE_SOURCE}`)();
  return fn(reps).ms;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function baselinePath(name) {
  return path.join(BASELINE_DIR, `${name}.json`);
}

export function writeBaseline(name, { calibrationMs, metrics, note }, file = baselinePath(name)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = { calibrationMs: round(calibrationMs), recordedAt: new Date().toISOString(), note, metrics };
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
}

/** The per-metric rule: the suite's override over the file default; null = report only. */
function ruleFor(tolerance, suite, key) {
  const gated = tolerance.suites?.[suite]?.gated ?? {};
  if (!(key in gated)) return null;
  return { ...tolerance.default, ...gated[key] };
}

/**
 * Compare `current` ({ calibrationMs, metrics }) with the suite's baseline.
 * Returns { rows, failures, missing }; prints nothing.
 */
export function compareToBaseline(suite, current, baseline, tolerance) {
  const rows = [];
  const failures = [];
  const missing = [];
  const keys = new Set([...Object.keys(baseline.metrics), ...Object.keys(current.metrics)]);
  const gatedKeys = Object.keys(tolerance.suites?.[suite]?.gated ?? {});
  for (const key of gatedKeys) if (!current.metrics[key]) missing.push(key);
  for (const key of [...keys].sort()) {
    const base = baseline.metrics[key];
    const now = current.metrics[key];
    const rule = ruleFor(tolerance, suite, key);
    if (!base || !now || base.p95 === null || now.p95 === null) {
      rows.push({ key, gate: rule ? 'gated' : 'report', base: base?.p95 ?? null, now: now?.p95 ?? null, change: null, verdict: 'new/absent' });
      continue;
    }
    const baseUnits = base.p95 / baseline.calibrationMs;
    const nowUnits = now.p95 / current.calibrationMs;
    const change = nowUnits / baseUnits - 1;
    let verdict = 'ok';
    if (rule && change > rule.maxRegression && now.p95 - base.p95 > rule.floorMs) {
      verdict = `REGRESSED > ${Math.round(rule.maxRegression * 100)} %`;
      failures.push({ key, change, base: base.p95, now: now.p95 });
    } else if (!rule) {
      verdict = 'report only';
    }
    rows.push({
      key,
      gate: rule ? 'gated' : 'report',
      n: now.n,
      base: round(base.p95, 3),
      now: round(now.p95, 3),
      change: `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)} %`,
      verdict,
    });
  }
  return { rows, failures, missing };
}

/** Print a comparison and return true when it passes. */
export function reportComparison(label, result, current, baseline) {
  console.log(
    `\n[${label}] p95 vs baseline (calibration ${round(current.calibrationMs, 2)} ms now, ${round(baseline.calibrationMs, 2)} ms baseline; change is calibration-normalised)`,
  );
  console.table(result.rows);
  for (const key of result.missing) console.error(`  ✗ gated metric ${key} has no samples in this run`);
  for (const f of result.failures) {
    console.error(`  ✗ ${f.key}: p95 ${round(f.base, 3)} → ${round(f.now, 3)} ms (${(f.change * 100).toFixed(1)} % normalised)`);
  }
  return result.failures.length === 0 && result.missing.length === 0;
}
