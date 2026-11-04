// @vitest-environment node
/**
 * The SWE time contract (#533), end to end on the committed wasm: the step
 * integrates the time it is asked for (sub-cycled past the CFL limit), says
 * so when the sub-step cap stops it short, and the frame loop's clocks
 * (`takeSweStep` → simTime, the surge front, hydro events, the router) agree
 * with the time the field integrated to the step.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { createWasmSweSim, type SweSim } from './sweSim';
import { SWE_MAX_STEP_DT, takeSweStep, type SweStepClock } from './sweHost';
import type { WatershedNativeModule } from './wasmAbi';
import { loadNativeFromDisk } from '../../testing/nativeFromDisk';

const G = 9.80665;
const H = 1;
const CFL = 0.4;

let wasm: WatershedNativeModule;

beforeAll(async () => {
  wasm = await loadNativeFromDisk();
});

/** A still pond with a uniform current `speed`, on a dx grid. */
function pond(dx: number, speed: number): SweSim {
  const sim = createWasmSweSim(wasm, 24, 16, dx);
  sim.u.fill(speed);
  sim.w.fill(-speed);
  return sim;
}

/** The solver's CFL limit for that pond at the start of a step. */
const cflLimit = (dx: number, speed: number) => (CFL * dx) / (Math.hypot(speed, speed) + Math.sqrt(G * H));

describe('stepShallowWater integrates the requested time (#533)', () => {
  it('a dt above the CFL limit, within 4 sub-steps, is integrated exactly', () => {
    const dx = 0.25;
    const sim = pond(dx, 0.5);
    const dt = Math.fround(0.05);
    expect(dt).toBeGreaterThan(cflLimit(dx, 0.5));
    expect(dt).toBeLessThan(4 * cflLimit(dx, 0.5));
    // Rejected (null planes): returns 0 and writes nothing.
    expect(wasm.stepShallowWater(0, 0, 0, 0, 24, 16, dt, G, dx, H)).toBe(0);
    sim.step({ dt, g: G, H, originX: 0, originZ: 0, events: [] });
    expect(sim.takeShortfall()).toBe(0);
    // Uniform flow damps by exp(-0.1 · dt) whatever the sub-step split.
    expect(sim.u[100]).toBeCloseTo(0.5 * Math.exp(-0.1 * dt), 6);
    sim.dispose();
  });

  it('past the cap it integrates 4 CFL steps and reports the rest as shortfall', () => {
    const dx = 0.05;
    const sim = pond(dx, 2);
    const dt = 0.05;
    const limit = cflLimit(dx, 2);
    expect(4 * limit).toBeLessThan(dt);
    sim.step({ dt, g: G, H, originX: 0, originZ: 0, events: [] });
    const short = sim.takeShortfall();
    expect(short).toBeGreaterThan(0);
    // ≈ dt − 4 sub-steps (each slightly longer as the current damps).
    expect(dt - short).toBeCloseTo(4 * limit, 4);
    expect(sim.takeShortfall()).toBe(0); // reported once
    sim.dispose();
  });
});

describe('takeSweStep: the clocks agree with the field (#533)', () => {
  /**
   * Run `frames` render frames of `frameDt` through takeSweStep and a field
   * that integrates at most `cap` per step. The shortfall reaches the next
   * frame's takeSweStep — on wasm-main because sweHostFrame reads it at the
   * top of the frame, on the worker / WGSL because it rides the next frame.
   */
  function run(frames: number, frameDt: number, interval: number, cap: number) {
    const clock: SweStepClock = { stepAccumulator: 0, fieldDebt: 0 };
    let simTime = 0;
    let surgeClock = 0;
    let integrated = 0;
    let pending: number[] = [];
    let maxLead = 0;
    for (let f = 0; f < frames; f += 1) {
      const owed = pending.reduce((a, b) => a + b, 0);
      pending = [];
      const due = takeSweStep(clock, frameDt, interval, owed);
      if (!due) continue;
      simTime += due.clockDt;
      surgeClock += due.clockDt;
      const got = Math.min(due.stepDt, cap);
      integrated += got;
      pending.push(due.stepDt - got);
      maxLead = Math.max(maxLead, simTime - integrated);
    }
    // Owed time is either not reported yet, or reported and waiting in the
    // accumulator for the next step (the clock's debt).
    const unreported = pending.reduce((a, b) => a + b, 0) + clock.fieldDebt;
    return { simTime, surgeClock, integrated, unreported, maxLead };
  }

  it('with no shortfall, clocks and field are the same number', () => {
    const r = run(600, 1 / 60, 1 / 30, 1);
    expect(r.unreported).toBe(0);
    expect(r.simTime).toBe(r.integrated);
    expect(r.surgeClock).toBe(r.integrated);
  });

  it('with a shortfall every step, they differ by at most the unreported step', () => {
    for (const frameDt of [1 / 60, 1 / 144, 1 / 24]) {
      const cap = 0.02; // below the 1/30 s step: every step falls short
      const r = run(600, frameDt, 1 / 30, cap);
      expect(r.simTime - r.integrated).toBeCloseTo(r.unreported, 12);
      expect(r.surgeClock).toBe(r.simTime);
      // Never more than one step's shortfall ahead.
      expect(r.maxLead).toBeLessThanOrEqual(SWE_MAX_STEP_DT + 1e-12);
    }
  });

  it('a hitch past SWE_MAX_STEP_DT drops new time from clocks and field alike', () => {
    const clock: SweStepClock = { stepAccumulator: 0, fieldDebt: 0 };
    const owed = 0.01;
    const due = takeSweStep(clock, 0.5, 1 / 30, owed);
    expect(due).toEqual({ stepDt: SWE_MAX_STEP_DT, clockDt: SWE_MAX_STEP_DT - owed });
    expect(clock).toEqual({ stepAccumulator: 0, fieldDebt: 0 });
  });

  it('ignores a non-finite shortfall', () => {
    const clock: SweStepClock = { stepAccumulator: 0, fieldDebt: 0 };
    expect(takeSweStep(clock, 1 / 30, 1 / 30, Number.NaN)).toEqual({ stepDt: 1 / 30, clockDt: 1 / 30 });
  });
});
