import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { BASELINE_DIR, compareToBaseline, quantile, readJson } from './perfBaseline.mjs';

const tolerance = readJson(path.join(BASELINE_DIR, 'tolerance.json'));
const baseline = readJson(path.join(BASELINE_DIR, 'meander.json'));
const GATED = Object.keys(tolerance.suites.meander.gated);

/** The baseline with every metric's p95 scaled by `factor` (same calibration). */
function scaled(factor, keys = Object.keys(baseline.metrics)) {
  const metrics = structuredClone(baseline.metrics);
  for (const key of keys) metrics[key].p95 *= factor;
  return { calibrationMs: baseline.calibrationMs, metrics };
}

describe('perf baseline gate (#559 E)', () => {
  it('gates sim step, segment build and segment mount on the meander run', () => {
    expect(GATED).toEqual(
      expect.arrayContaining(['main/sim-step', 'main: segments/segment-build', 'main: segments/segment-mount']),
    );
    for (const key of GATED) expect(baseline.metrics[key]?.n).toBeGreaterThan(10);
  });

  it('fails a 20 % p95 rise in segment build or the sim step', () => {
    for (const key of ['main/sim-step', 'main: segments/segment-build']) {
      const result = compareToBaseline('meander', scaled(1.2, [key]), baseline, tolerance);
      expect(result.failures.map((f) => f.key)).toEqual([key]);
    }
  });

  it('passes run-to-run noise and the same box measuring itself', () => {
    expect(compareToBaseline('meander', scaled(1), baseline, tolerance).failures).toEqual([]);
    expect(compareToBaseline('meander', scaled(1.12), baseline, tolerance).failures).toEqual([]);
  });

  it('normalises by calibration: a box twice as slow is not a regression', () => {
    const slow = scaled(2);
    slow.calibrationMs = baseline.calibrationMs * 2;
    expect(compareToBaseline('meander', slow, baseline, tolerance).failures).toEqual([]);
  });

  it('reports ungated spans without failing, and names a gated span with no samples', () => {
    const render = compareToBaseline('meander', scaled(3, ['main/render']), baseline, tolerance);
    expect(render.failures).toEqual([]);
    const current = scaled(1);
    delete current.metrics['main/sim-step'];
    expect(compareToBaseline('meander', current, baseline, tolerance).missing).toEqual(['main/sim-step']);
  });

  it('quantile interpolates', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.95)).toBeCloseTo(9.5);
    expect(quantile([], 0.5)).toBeNull();
  });
});
