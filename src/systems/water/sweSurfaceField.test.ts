import { describe, expect, it } from 'vitest';
import { WATER_SHADER } from '../../constants/game';
import { FALLBACK_FLOW_DIR, SWE_DRY_DEPTH } from './sampleSWEFlow';
import {
  SWE_FLOW_CHANNELS,
  packSweSurfaceField,
  sweFoamWeight,
  sweStreakAxis,
  type SweSurfaceGrid,
} from './sweSurfaceField';

const MEAN = 1;

function makeGrid(width = 8, height = 6, dx = 0.5, b = 0): SweSurfaceGrid {
  const n = width * height;
  return {
    width,
    height,
    dx,
    h: new Float32Array(n),
    u: new Float32Array(n),
    w: new Float32Array(n),
    b: new Float32Array(n).fill(b),
  };
}

function texel(out: Float32Array, width: number, gx: number, gz: number) {
  const o = (gz * width + gx) * SWE_FLOW_CHANNELS;
  return { u: out[o], w: out[o + 1], depth: out[o + 2], div: out[o + 3] };
}

describe('packSweSurfaceField', () => {
  it('packs (u, w, depth) for a known texel', () => {
    const g = makeGrid();
    const idx = 2 * g.width + 3;
    g.u[idx] = 1.25;
    g.w[idx] = -0.5;
    g.h[idx] = 0.3;
    g.b[idx] = 0.2;
    const out = new Float32Array(g.width * g.height * SWE_FLOW_CHANNELS);
    packSweSurfaceField(g, out, MEAN);
    const t = texel(out, g.width, 3, 2);
    expect(t.u).toBeCloseTo(1.25);
    expect(t.w).toBeCloseTo(-0.5);
    expect(t.depth).toBeCloseTo(MEAN + 0.3 - 0.2);
  });

  it('floors depth at 0 for a bed above the surface (dry bank)', () => {
    const g = makeGrid(4, 4, 0.5, 3);
    const out = new Float32Array(4 * 4 * SWE_FLOW_CHANNELS);
    packSweSurfaceField(g, out, MEAN);
    expect(texel(out, 4, 1, 1).depth).toBe(0);
  });

  it('measures positive divergence where the flow spreads, and 0 on a uniform stream', () => {
    const g = makeGrid(9, 5, 0.5);
    // u grows with x: du/dx = 1 / s at the interior.
    for (let gz = 0; gz < g.height; gz += 1) {
      for (let gx = 0; gx < g.width; gx += 1) g.u[gz * g.width + gx] = gx * 0.5;
    }
    const out = new Float32Array(g.width * g.height * SWE_FLOW_CHANNELS);
    packSweSurfaceField(g, out, MEAN);
    expect(texel(out, g.width, 4, 2).div).toBeCloseTo(1, 5);

    const uniform = makeGrid(9, 5, 0.5);
    uniform.w.fill(-1.5);
    packSweSurfaceField(uniform, out, MEAN);
    expect(texel(out, 9, 4, 2).div).toBeCloseTo(0, 6);
  });

  it('forces divergence to 0 on dry cells', () => {
    const g = makeGrid(9, 5, 0.5, 3);
    for (let gx = 0; gx < g.width; gx += 1) g.u[2 * g.width + gx] = gx;
    const out = new Float32Array(g.width * g.height * SWE_FLOW_CHANNELS);
    packSweSurfaceField(g, out, MEAN);
    expect(texel(out, g.width, 4, 2).div).toBe(0);
  });

  it('writes in place: same buffer, no reallocation, repeatable', () => {
    const g = makeGrid();
    const out = new Float32Array(g.width * g.height * SWE_FLOW_CHANNELS);
    const before = out.buffer;
    packSweSurfaceField(g, out, MEAN);
    g.u[0] = 2;
    packSweSurfaceField(g, out, MEAN);
    expect(out.buffer).toBe(before);
    expect(out[0]).toBe(2);
  });
});

describe('sweStreakAxis', () => {
  const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

  it('quiet cell falls back to the authored downstream vector', () => {
    const a = sweStreakAxis(0.01, 0.01, 1);
    expect(a.blend).toBe(0);
    near(a.dirX, FALLBACK_FLOW_DIR.x);
    near(a.dirZ, FALLBACK_FLOW_DIR.z);
  });

  it('follows a planted velocity once above the full-speed threshold', () => {
    const speed = WATER_SHADER.SWE_STREAK_FULL_SPEED * 3;
    const a = sweStreakAxis(speed, 0, 1); // flowing +X
    expect(a.blend).toBeCloseTo(1, 6);
    near(a.dirX, 1);
    near(a.dirZ, 0);
    const b = sweStreakAxis(-speed * 0.6, speed * 0.8, 1);
    near(b.dirX, -0.6);
    near(b.dirZ, 0.8);
  });

  it('is fully authored in dry cells regardless of speed', () => {
    const a = sweStreakAxis(5, 0, 0);
    expect(a.blend).toBe(0);
    near(a.dirZ, FALLBACK_FLOW_DIR.z);
  });

  it('blends smoothly between the thresholds and returns a unit vector', () => {
    const mid = (WATER_SHADER.SWE_STREAK_MIN_SPEED + WATER_SHADER.SWE_STREAK_FULL_SPEED) / 2;
    const a = sweStreakAxis(mid, 0, 1);
    expect(a.blend).toBeGreaterThan(0);
    expect(a.blend).toBeLessThan(1);
    expect(Math.hypot(a.dirX, a.dirZ)).toBeCloseTo(1, 6);
    expect(a.dirX).toBeGreaterThan(0);
  });
});

describe('sweFoamWeight', () => {
  it('a dry bank cell contributes bank foam', () => {
    const w = sweFoamWeight(0, 0);
    expect(w.bank).toBe(1);
    expect(w.total).toBe(1);
  });

  it('a deep, uniform cell contributes none', () => {
    const w = sweFoamWeight(MEAN, 0);
    expect(w.bank).toBe(0);
    expect(w.jump).toBe(0);
    expect(w.total).toBe(0);
  });

  it('bank foam ramps off across the wetting band', () => {
    const half = sweFoamWeight(WATER_SHADER.SWE_WET_BAND / 2, 0).bank;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(sweFoamWeight(WATER_SHADER.SWE_WET_BAND, 0).bank).toBe(0);
  });

  it('raises jump foam where divergence is positive, not where it is negative', () => {
    const hi = sweFoamWeight(MEAN, WATER_SHADER.SWE_JUMP_DIV_HI);
    expect(hi.jump).toBe(1);
    expect(hi.total).toBeCloseTo(WATER_SHADER.SWE_JUMP_FOAM_INTENSITY, 6);
    expect(sweFoamWeight(MEAN, -WATER_SHADER.SWE_JUMP_DIV_HI).jump).toBe(0);
  });

  it('never adds jump foam on a dry cell', () => {
    expect(sweFoamWeight(SWE_DRY_DEPTH / 2, 10).jump).toBe(0);
  });
});
