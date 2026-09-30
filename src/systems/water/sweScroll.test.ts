import { describe, expect, it } from 'vitest';
import { SWE_BUDGETS } from './sweQuality';
import {
  SWE_REST_INFLOW,
  advanceSweWindow,
  scrollField,
  type SweWindow,
  type SweWindowStep,
} from './sweScroll';
import { createWasmSweSim, type SweSim } from './sweSim';
import type { WatershedNativeModule } from './WatershedWasm';

const HIGH = SWE_BUDGETS.high; // 48 x 32 at 0.5 m
const MEDIUM = SWE_BUDGETS.medium; // 32 x 24 at 0.75 m

/** Tiny deterministic PRNG so the property tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('advanceSweWindow', () => {
  it('seeds the window on the cell lattice with no shift on the first frame', () => {
    const step = advanceSweWindow(null, 3.3, -40.1, HIGH)!;
    expect(step.shiftX).toBe(0);
    expect(step.shiftZ).toBe(0);
    // Origin is an exact multiple of the cell size, within half a cell of ideal.
    expect(step.window.originX).toBe(step.window.cellX * HIGH.cellSize);
    expect(step.window.originZ).toBe(step.window.cellZ * HIGH.cellSize);
    expect(Math.abs(step.window.originX - (3.3 - HIGH.width * HIGH.cellSize * 0.5))).toBeLessThanOrEqual(
      HIGH.cellSize * 0.5 + 1e-9,
    );
    expect(Math.abs(step.window.originZ - (-40.1 - HIGH.height * HIGH.cellSize * 0.5))).toBeLessThanOrEqual(
      HIGH.cellSize * 0.5 + 1e-9,
    );
  });

  it('does not move for sub-cell motion — the existing bed-refresh gate', () => {
    const first = advanceSweWindow(null, 0, 0, HIGH)!;
    // Up to (just under) one cell of drift either way: still the same window.
    for (const drift of [0.1, 0.3, 0.49, -0.1, -0.3, -0.49]) {
      const step = advanceSweWindow(first.window, drift, drift, HIGH)!;
      expect(step.window).toBe(first.window);
      expect(step.shiftX).toBe(0);
      expect(step.shiftZ).toBe(0);
    }
  });

  it('moves by whole cells once a full cell of drift has accumulated', () => {
    const first = advanceSweWindow(null, 0, 0, HIGH)!;
    const step = advanceSweWindow(first.window, 0 + 3 * HIGH.cellSize, 0, HIGH)!;
    expect(step.window.cellX).toBe(first.window.cellX + 3);
    expect(step.window.cellZ).toBe(first.window.cellZ);
    expect(step.shiftX).toBe(-3);
    expect(step.shiftZ).toBe(0);
  });

  it('uses the header sign: a window travelling downstream (−Z) has a positive shiftZ', () => {
    const first = advanceSweWindow(null, 0, 0, HIGH)!;
    const step = advanceSweWindow(first.window, 0, -4 * HIGH.cellSize, HIGH)!;
    expect(step.window.originZ).toBeLessThan(first.window.originZ);
    expect(step.shiftZ).toBe(4);
    expect(step.shiftZ).toBe((first.window.originZ - step.window.originZ) / HIGH.cellSize);
  });

  it('has hysteresis: jitter across a cell boundary never thrashes the field', () => {
    let window: SweWindow = advanceSweWindow(null, 0, 0, HIGH)!.window;
    let moves = 0;
    // A vehicle bobbing ±0.4 cells about the exact point where the window is
    // due to move, for 200 frames: one move to catch up, then it stays put.
    for (let f = 0; f < 200; f += 1) {
      const x = (1 + (f % 2 === 0 ? 0.4 : -0.4)) * HIGH.cellSize;
      const step = advanceSweWindow(window, x, 0, HIGH)!;
      if (step.shiftX !== 0) moves += 1;
      window = step.window;
    }
    expect(moves).toBe(1);
  });

  it('keeps the window on the lattice and its shifts equal to the origin delta over a random walk', () => {
    for (const budget of [HIGH, MEDIUM]) {
      const rand = mulberry32(7);
      let x = 12.34;
      let z = -55.5;
      let window = advanceSweWindow(null, x, z, budget)!.window;
      let sumX = 0;
      let sumZ = 0;
      const start = window;
      for (let f = 0; f < 2000; f += 1) {
        x += (rand() - 0.4) * 1.2;
        z -= rand() * 1.6; // mostly downstream, as in play
        const step = advanceSweWindow(window, x, z, budget)!;
        sumX += step.shiftX;
        sumZ += step.shiftZ;
        window = step.window;
        expect(Number.isInteger(window.cellX)).toBe(true);
        expect(window.originX).toBe(window.cellX * budget.cellSize);
        // Never lags the ideal centre by a full cell.
        const idealX = x / budget.cellSize - budget.width * 0.5;
        const idealZ = z / budget.cellSize - budget.height * 0.5;
        expect(Math.abs(idealX - window.cellX)).toBeLessThan(1);
        expect(Math.abs(idealZ - window.cellZ)).toBeLessThan(1);
      }
      // Σ shift = (start − end) / cell: nothing double-counted, nothing dropped.
      expect(sumX).toBe(start.cellX - window.cellX);
      expect(sumZ).toBe(start.cellZ - window.cellZ);
    }
  });

  it('turns a respawn-sized jump into one large shift', () => {
    const first = advanceSweWindow(null, 0, 0, HIGH)!;
    const step = advanceSweWindow(first.window, 400, -900, HIGH)!;
    expect(Math.abs(step.shiftX)).toBeGreaterThan(HIGH.width);
    expect(Math.abs(step.shiftZ)).toBeGreaterThan(HIGH.height);
  });

  it('refuses a non-finite anchor so a physics glitch cannot poison the window', () => {
    const first = advanceSweWindow(null, 0, 0, HIGH)!;
    expect(advanceSweWindow(first.window, Number.NaN, 0, HIGH)).toBeNull();
    expect(advanceSweWindow(first.window, 0, Number.POSITIVE_INFINITY, HIGH)).toBeNull();
    expect(advanceSweWindow(null, Number.NaN, 0, HIGH)).toBeNull();
  });

  it('never reports −0 as a shift', () => {
    const first = advanceSweWindow(null, 0, 0, HIGH)!;
    const step = advanceSweWindow(first.window, 0.2, -0.2, HIGH)!;
    expect(Object.is(step.shiftX, 0)).toBe(true);
    expect(Object.is(step.shiftZ, 0)).toBe(true);
    const moved = advanceSweWindow(first.window, 0.2, -3 * HIGH.cellSize, HIGH)!;
    expect(Object.is(moved.shiftX, 0)).toBe(true);
  });
});

describe('scrollField — the TypeScript twin of scrollShallowWater', () => {
  const W = 16;
  const H = 12;
  const at = (x: number, z: number) => z * W + x;
  const planes = () => {
    const n = W * H;
    const p = {
      h: new Float32Array(n),
      u: new Float32Array(n),
      w: new Float32Array(n),
      b: new Float32Array(n),
    };
    for (let i = 0; i < n; i += 1) {
      p.h[i] = 1 + 0.01 * i;
      p.u[i] = -2 - 0.01 * i;
      p.w[i] = 3 + 0.01 * i;
      p.b[i] = 0.5 + 0.001 * i;
    }
    return p;
  };

  it('is dst[x, z] = src[x − shiftX, z − shiftZ] with inflow fill and an edge-extended bed', () => {
    const src = planes();
    const dst = planes();
    const inflow = { eta: 0.05, u: 0.1, w: -0.2 };
    expect(scrollField(dst, W, H, 3, -2, inflow)).toBe(true);
    for (let z = 0; z < H; z += 1) {
      for (let x = 0; x < W; x += 1) {
        const sx = x - 3;
        const sz = z + 2;
        const i = at(x, z);
        if (sx >= 0 && sx < W && sz >= 0 && sz < H) {
          const s = at(sx, sz);
          expect([dst.h[i], dst.u[i], dst.w[i]]).toEqual([src.h[s], src.u[s], src.w[s]]);
        } else {
          expect([dst.h[i], dst.u[i], dst.w[i]]).toEqual([Math.fround(0.05), Math.fround(0.1), Math.fround(-0.2)]);
        }
        expect(dst.b[i]).toBe(src.b[at(Math.min(Math.max(sx, 0), W - 1), Math.min(Math.max(sz, 0), H - 1))]);
      }
    }
  });

  it('moves content to higher indices for a positive shift and never wraps', () => {
    const p = planes();
    p.h.fill(0);
    p.h[at(5, 6)] = 0.3;
    scrollField(p, W, H, 0, 2);
    expect(p.h[at(5, 8)]).toBe(Math.fround(0.3));
    expect(p.h[at(5, 6)]).toBe(0);
    // Off the upstream (high-row) edge: gone, and nothing reappears at row 0.
    scrollField(p, W, H, 0, 6);
    expect(p.h.every((v) => v === 0)).toBe(true);
  });

  it('saturates a teleport-sized shift and ignores zero / non-finite ones', () => {
    const p = planes();
    expect(scrollField(p, W, H, 1e9, -1e9)).toBe(true);
    expect(p.h.every((v) => v === 0)).toBe(true);
    const q = planes();
    const before = Array.from(q.h);
    expect(scrollField(q, W, H, 0, 0)).toBe(false);
    expect(scrollField(q, W, H, Number.NaN, 1)).toBe(false);
    expect(scrollField(q, W, H, 1, Number.POSITIVE_INFINITY)).toBe(false);
    expect(Array.from(q.h)).toEqual(before);
  });

  it('leaves the bed alone when there is none', () => {
    const p = planes();
    const { b: _b, ...noBed } = p;
    expect(scrollField(noBed, W, H, 2, 1)).toBe(true);
  });
});

/**
 * A heap-backed module with no `scrollShallowWater`: exactly what an ABI-8
 * binary looks like, so `createWasmSweSim` takes the TS-twin fallback. The
 * real export is exercised against the same scenario in
 * sweScroll.integration.test.ts.
 */
function abi8Module(): WatershedNativeModule {
  const heap = new Float32Array(1 << 18);
  let next = 16; // floats; keep 0 free so no grid gets pointer 0
  return {
    HEAPF32: heap,
    allocateGrid(count: number) {
      const ptr = next * 4;
      next += count;
      return ptr;
    },
    freeGrid() {},
  } as unknown as WatershedNativeModule;
}

/** Index of the largest η, as a world position on the sim's current window. */
function peakWorld(sim: SweSim, window: SweWindow, cellSize: number) {
  let best = -Infinity;
  let idx = 0;
  for (let i = 0; i < sim.h.length; i += 1) {
    if (sim.h[i] > best) {
      best = sim.h[i];
      idx = i;
    }
  }
  return {
    x: window.originX + (idx % sim.width) * cellSize,
    z: window.originZ + Math.floor(idx / sim.width) * cellSize,
    eta: best,
  };
}

function gaussianBump(sim: SweSim, window: SweWindow, cellSize: number, wx: number, wz: number, amp: number) {
  for (let j = 0; j < sim.height; j += 1) {
    for (let i = 0; i < sim.width; i += 1) {
      const dx = window.originX + i * cellSize - wx;
      const dz = window.originZ + j * cellSize - wz;
      sim.h[j * sim.width + i] = amp * Math.exp(-(dx * dx + dz * dz) / 2);
    }
  }
}

describe('a world-fixed splash while the window travels (WaterForceSystem frame order)', () => {
  const budget = HIGH;

  /** One frame of WaterForceSystem, minus the solver: advance, scroll, then it would refresh the bed. */
  function drive(sim: SweSim, path: readonly (readonly [number, number])[], scroll: boolean) {
    let window: SweWindow | null = null;
    const seen: { x: number; z: number; eta: number }[] = [];
    let bump: { x: number; z: number } | null = null;
    for (const [ax, az] of path) {
      const step: SweWindowStep = advanceSweWindow(window, ax, az, budget)!;
      if (window === null) {
        // A splash a few metres ahead of the vehicle (row 4 = downstream edge
        // side), placed so it stays inside the window for the whole run.
        const first = step.window;
        window = first;
        bump = { x: first.originX + 24 * budget.cellSize, z: first.originZ + 4 * budget.cellSize };
        gaussianBump(sim, first, budget.cellSize, bump.x, bump.z, 0.4);
        continue;
      }
      if (scroll && (step.shiftX !== 0 || step.shiftZ !== 0)) sim.scroll(step.shiftX, step.shiftZ);
      window = step.window;
      seen.push(peakWorld(sim, window, budget.cellSize));
    }
    return { seen, bump: bump! };
  }

  // The vehicle runs 12 m downstream (−Z) and drifts 3 m sideways, in sub-cell
  // increments — several cells of window motion, none of it in one frame.
  const path: [number, number][] = [];
  for (let f = 0; f <= 60; f += 1) path.push([0.05 * f, -0.2 * f]);

  it('keeps the peak on its world cell every frame', () => {
    const sim = createWasmSweSim(abi8Module(), budget.width, budget.height, budget.cellSize);
    const { seen, bump } = drive(sim, path, true);
    expect(seen.length).toBe(path.length - 1);
    for (const p of seen) {
      expect(p.x).toBe(bump.x);
      expect(p.z).toBe(bump.z);
      expect(p.eta).toBeCloseTo(0.4, 6);
    }
    sim.dispose();
  });

  it('control: without the scroll the same splash rides the camera', () => {
    const sim = createWasmSweSim(abi8Module(), budget.width, budget.height, budget.cellSize);
    const { seen, bump } = drive(sim, path, false);
    const last = seen[seen.length - 1];
    // The bug this fixes: η stays in its index slot, so its world position
    // follows the window origin — here 12 m downstream and 3 m sideways.
    expect(Math.abs(last.z - bump.z)).toBeGreaterThan(10);
    expect(Math.abs(last.x - bump.x)).toBeGreaterThan(2);
    sim.dispose();
  });

  it('drops a splash that scrolls off the upstream edge instead of wrapping it', () => {
    const sim = createWasmSweSim(abi8Module(), budget.width, budget.height, budget.cellSize);
    // Vehicle runs 40 m downstream: the splash is far upstream of the window.
    const long: [number, number][] = [];
    for (let f = 0; f <= 100; f += 1) long.push([0, -0.4 * f]);
    const { seen } = drive(sim, long, true);
    const last = seen[seen.length - 1];
    expect(last.eta).toBe(0);
    expect(sim.h.every((v) => v === 0)).toBe(true);
    sim.dispose();
  });

  it('bumps fieldVersion on a scroll so the height texture is re-uploaded against the new origin', () => {
    const sim = createWasmSweSim(abi8Module(), budget.width, budget.height, budget.cellSize);
    const v0 = sim.fieldVersion;
    sim.scroll(0, 0);
    sim.scroll(Number.NaN, 1);
    expect(sim.fieldVersion).toBe(v0);
    sim.scroll(2, 0, SWE_REST_INFLOW);
    expect(sim.fieldVersion).toBe(v0 + 1);
    sim.dispose();
  });
});
