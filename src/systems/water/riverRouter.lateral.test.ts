// @vitest-environment node
/**
 * Weather over a reach joins the river there (ABI 14 lateral inflow, #464 D).
 *
 * A storm the director sits over chain segment 2 is runoff entering segment 2,
 * not more water at the head: reach 2 hears it at once, the reaches below with
 * the routed lag, the reaches above never. Runs on the committed pair, so
 * `pnpm test` checks the binary that ships.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { loadNativeFromDisk } from '../../testing/nativeFromDisk';
import { getRoutingReach } from '../map/routingReach';
import { DEFAULT_FORECAST_INPUTS } from '../../constants/forecast';
import { SWE_MEAN_DEPTH } from './SWEHeightField';
import { createRiverRouter, type RiverRouter, type RouterWeather } from './riverRouter';
import type { WatershedNativeModule } from './wasmAbi';

const LAUNCH_HOUR = 10;
const G = 9.80665;
const STORM_OVER_2: RouterWeather = { type: 'storm', intensity: 0.9, overChainIndex: 2 };
const STORM_AT_HEAD: RouterWeather = { type: 'storm', intensity: 0.9, overChainIndex: null };

let wasm: WatershedNativeModule;

beforeAll(async () => {
  wasm = await loadNativeFromDisk();
});

function routerWith(weather: RouterWeather | null): RiverRouter {
  const router = createRiverRouter(wasm, getRoutingReach(), LAUNCH_HOUR, {
    forecast: { ...DEFAULT_FORECAST_INPUTS, weather: null },
  });
  if (!router) throw new Error('committed binary has no routing exports');
  router.setWeather(weather);
  return router;
}

const eta = (router: RiverRouter, k: number) => router.edgeState(k, SWE_MEAN_DEPTH, G).eta;

/** Run a clear router and a weather router side by side; the stage rise at each `ks` per step. */
function rises(weather: RouterWeather, ks: number[], seconds: number, dt = 1): number[][] {
  const clear = routerWith(null);
  const wet = routerWith(weather);
  const out: number[][] = [];
  for (let t = 0; t < seconds; t += dt) {
    clear.advance(dt);
    wet.advance(dt);
    out.push(ks.map((k) => eta(wet, k) - eta(clear, k)));
  }
  clear.dispose();
  wet.dispose();
  return out;
}

/** First step index whose rise at column `col` passes `threshold`, or −1. */
const firstAbove = (series: number[][], col: number, threshold: number) =>
  series.findIndex((row) => row[col] > threshold);

describe('RiverRouter — a storm over reach 2 (lateral inflow)', () => {
  it('raises the stage at reach 2 at once and never at reach 0 or 1', () => {
    const series = rises(STORM_OVER_2, [0, 1, 2], 120);
    expect(series[0][2]).toBeGreaterThan(0.01);
    for (const [r0, r1] of series) {
      expect(r0).toBe(0);
      expect(r1).toBe(0);
    }
  });

  it('reaches the segment below only with the routed lag', () => {
    const reach = getRoutingReach();
    const probe = routerWith(null);
    const segmentLag = probe.lag(3) - probe.lag(2);
    probe.dispose();
    expect(segmentLag).toBeGreaterThan(2);

    const seconds = Math.ceil(segmentLag * 4);
    const series = rises(STORM_OVER_2, [2, 3], seconds);
    const full = series.at(-1)![0];
    expect(full).toBeGreaterThan(0.01);
    // One step in, the rise below is a small fraction of the rise at 2…
    expect(series[0][1]).toBeLessThan(0.1 * series[0][0]);
    // …and half of it arrives around one segment's travel time later.
    const halfBelow = firstAbove(series, 1, 0.5 * full);
    expect(halfBelow).toBeGreaterThan(0.25 * segmentLag);
    expect(halfBelow).toBeLessThan(3 * segmentLag);
    expect(reach.segments.length).toBeGreaterThan(3);
  });

  it('the same storm at the head reaches reach 0 before reach 2 — the order flips', () => {
    const atHead = rises(STORM_AT_HEAD, [0, 2], 400);
    const overTwo = rises(STORM_OVER_2, [0, 2], 400);
    const threshold = 0.02;
    const headAt0 = firstAbove(atHead, 0, threshold);
    const headAt2 = firstAbove(atHead, 1, threshold);
    expect(headAt0).toBeGreaterThanOrEqual(0);
    expect(headAt2).toBeGreaterThan(headAt0);
    expect(firstAbove(overTwo, 1, threshold)).toBeLessThan(headAt2);
    expect(firstAbove(overTwo, 0, threshold)).toBe(-1);
  });

  it('clearing the weather drops the lateral back out', () => {
    const router = routerWith(STORM_OVER_2);
    const clear = routerWith(null);
    for (let t = 0; t < 30; t += 1) {
      router.advance(1);
      clear.advance(1);
    }
    expect(router.dischargeInto(2)).toBeGreaterThan(clear.dischargeInto(2));
    router.setWeather(null);
    router.advance(1);
    clear.advance(1);
    // No runoff joins any more: what enters reach 2 is reach 1's outflow, as on the clear day.
    expect(router.dischargeInto(2)).toBe(clear.dischargeInto(2));
    const lateralOff = router.dischargeInto(2);
    router.setWeather(STORM_OVER_2);
    router.advance(1);
    expect(router.dischargeInto(2)).toBeGreaterThan(lateralOff);
    router.dispose();
    clear.dispose();
  });
});
