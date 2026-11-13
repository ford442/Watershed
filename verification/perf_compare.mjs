#!/usr/bin/env node
/**
 * perf_compare.mjs — diff a `profile:swe` / `profile:spawn` report against its
 * committed baseline, the same way perf_trace_smoke.mjs diffs trace spans
 * (#559 E, perfBaseline.mjs).
 *
 *   pnpm profile:swe -- --json verification/output/swe.json
 *   node verification/perf_compare.mjs swe verification/output/swe.json
 *
 *   pnpm profile:spawn                     # writes output/spawn-profile/spawn-profile-default.json
 *   node verification/perf_compare.mjs spawn verification/output/spawn-profile/spawn-profile-default.json
 *
 *   … --update                             # write perf-baselines/<suite>.json instead
 *
 * The calibration workload runs here, in Node, on the box that produced the
 * report: run the comparison right after the profile, on the same machine.
 * Metrics:
 *   swe    `swe-step/<WxH>`                      p50 = the bench's median, p95 its p95
 *   spawn  `spawn/<quality>/segment-build|mount` over the treadmill appends
 * Gated keys and tolerances: perf-baselines/tolerance.json (`suites.<suite>`).
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BASELINE_DIR,
  baselinePath,
  calibrateNode,
  compareToBaseline,
  quantile,
  readJson,
  reportComparison,
  round,
  writeBaseline,
} from './perfBaseline.mjs';

export function sweMetrics(report) {
  const results = Array.isArray(report) ? report : report.results;
  const metrics = {};
  for (const r of results) metrics[`swe-step/${r.size}`] = { n: r.steps, p50: round(r.medianMs), p95: round(r.p95Ms) };
  return metrics;
}

export function spawnMetrics(report) {
  const metrics = {};
  for (const run of report.runs) {
    const mounts = run.mounts.filter((m) => m.phase === 'treadmill');
    const builds = mounts.map((m) => m.buildMs).filter((v) => v !== null && v !== undefined);
    const mountMs = mounts.map((m) => m.mountMs).filter((v) => v !== null && v !== undefined);
    for (const [name, list] of [['segment-build', builds], ['segment-mount', mountMs]]) {
      if (list.length === 0) continue;
      metrics[`spawn/${run.quality}/${name}`] = { n: list.length, p50: round(quantile(list, 0.5)), p95: round(quantile(list, 0.95)) };
    }
  }
  return metrics;
}

const EXTRACT = { swe: sweMetrics, spawn: spawnMetrics };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [suite, reportFile, ...rest] = process.argv.slice(2);
  if (!EXTRACT[suite] || !reportFile) {
    console.error('usage: node verification/perf_compare.mjs <swe|spawn> <report.json> [--update]');
    process.exit(2);
  }
  const current = { calibrationMs: calibrateNode(), metrics: EXTRACT[suite](readJson(reportFile)) };
  if (rest.includes('--update')) {
    const file = writeBaseline(suite, { ...current, note: `${suite} profile report, calibrated in Node on the same box` });
    console.log(`[perf-compare] baseline written: ${path.relative(process.cwd(), file)}`);
  } else {
    const baseline = readJson(baselinePath(suite));
    const tolerance = readJson(path.join(BASELINE_DIR, 'tolerance.json'));
    const result = compareToBaseline(suite, current, baseline, tolerance);
    if (!reportComparison(`perf-compare ${suite}`, result, current, baseline)) process.exitCode = 1;
  }
}
