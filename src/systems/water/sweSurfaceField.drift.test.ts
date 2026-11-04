// @vitest-environment node
/**
 * The packed flow texture (#533): `packSurfaceField` (emscripten/chores.cpp)
 * against the stencil it replaced, written with every operation rounded to
 * float32 (`Math.fround`), in the C++ order (src/testing/sweSurfacePack.ts). A match is bytes, not a
 * tolerance: the TypeScript loop that packed `sweFlowMap` on the main thread
 * every step is gone, and this is what keeps the native one honest.
 *
 * Runs against the committed public/ pair (`loadNativeFromDisk`), like
 * nativeDigest.integration.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { WS_OK, WS_REJECTED, type WatershedNativeModule } from './wasmAbi';
import { loadNativeFromDisk } from '../../testing/nativeFromDisk';
import { referencePackSurface } from '../../testing/sweSurfacePack';

const f = Math.fround;

interface Field {
  width: number;
  height: number;
  h: Float32Array;
  u: Float32Array;
  w: Float32Array;
  b: Float32Array;
}

const referencePack = (g: Field, H: number, dx: number) => referencePackSurface(g, g.width, g.height, H, dx);

function randomField(width: number, height: number, seed: number, dryEvery = 5): Field {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s / 0xffffffff;
  };
  const n = width * height;
  const g: Field = {
    width,
    height,
    h: new Float32Array(n),
    u: new Float32Array(n),
    w: new Float32Array(n),
    b: new Float32Array(n),
  };
  for (let i = 0; i < n; i += 1) {
    g.h[i] = (next() - 0.5) * 0.4;
    g.u[i] = (next() - 0.5) * 6;
    g.w[i] = (next() - 0.5) * 6;
    g.b[i] = i % dryEvery === 0 ? 1.6 : next() * 0.6;
  }
  return g;
}

let wasm: WatershedNativeModule;

beforeAll(async () => {
  wasm = await loadNativeFromDisk();
});

function nativePack(g: Field, H: number, dx: number, flatBed = false): { status: number; out: Float32Array } {
  const n = g.width * g.height;
  const ptrs = [n, n, n, n, 4 * n].map((c) => wasm.allocateGrid(c));
  const [hp, up, wp, bp, op] = ptrs;
  const view = (p: number, c: number) => new Float32Array(wasm.HEAPF32.buffer, p, c);
  view(hp, n).set(g.h);
  view(up, n).set(g.u);
  view(wp, n).set(g.w);
  view(bp, n).set(g.b);
  const status = wasm.packSurfaceField(hp, up, wp, flatBed ? 0 : bp, g.width, g.height, H, dx, op);
  const out = view(op, 4 * n).slice();
  for (const p of ptrs) wasm.freeGrid(p);
  return { status, out };
}

const bits = (a: Float32Array) => new Uint32Array(a.buffer, a.byteOffset, a.length);

describe('packSurfaceField: native bytes == the float32 stencil (#533)', () => {
  // 1-3 columns: scalar only; 6: one 4-wide group; 9 / 13 / 128: ragged
  // overlapping groups; heights 1 / 2 exercise the extent-1 and one-sided z axis.
  const SIZES: [number, number][] = [
    [1, 1], [2, 1], [3, 2], [5, 4], [6, 3], [9, 7], [13, 1], [48, 32], [128, 80],
  ];

  it.each(SIZES)('%i x %i, random wet/dry field', (width, height) => {
    for (const [H, dx] of [[1, 0.75], [1.2, 0.5], [0.8, 2]] as const) {
      const g = randomField(width, height, width * 977 + height * 131 + Math.round(dx * 8));
      const { status, out } = nativePack(g, H, dx);
      expect(status).toBe(WS_OK);
      const want = referencePack(g, H, dx);
      const got = bits(out);
      const ref = bits(want);
      let firstBad = -1;
      for (let i = 0; i < ref.length && firstBad < 0; i += 1) if (got[i] !== ref[i]) firstBad = i;
      expect(firstBad, firstBad < 0 ? '' : `texel ${firstBad >> 2} ch ${firstBad & 3}: ${out[firstBad]} vs ${want[firstBad]}`)
        .toBe(-1);
    }
  });

  it('packs (u, w, depth) for a known texel, and div on a spreading flow', () => {
    const g = randomField(9, 5, 7, 1e9);
    g.h.fill(0);
    g.b.fill(0.25);
    for (let z = 0; z < 5; z += 1) for (let x = 0; x < 9; x += 1) g.u[z * 9 + x] = x * 0.5;
    g.w.fill(-0.75);
    const { out } = nativePack(g, 1, 0.5);
    const o = (2 * 9 + 4) * 4;
    expect(out[o]).toBe(2);
    expect(out[o + 1]).toBe(-0.75);
    expect(out[o + 2]).toBe(0.75);
    // du/dx = 0.5 / 0.5 per cell = 1 /s; w is uniform.
    expect(out[o + 3]).toBeCloseTo(1, 6);
  });

  it('a dry bank has depth 0 and div 0; bPtr 0 is a flat bed', () => {
    const g = randomField(6, 4, 3);
    g.b.fill(3);
    const dry = nativePack(g, 1, 0.75).out;
    for (let i = 0; i < 24; i += 1) {
      expect(dry[i * 4 + 2]).toBe(0);
      expect(dry[i * 4 + 3]).toBe(0);
    }
    const flat = nativePack(g, 1, 0.75, true).out;
    expect(flat[2]).toBe(f(1 + g.h[0]));
  });

  it('rejects a bad dx, a non-finite H or an oversized extent and writes nothing', () => {
    const g = randomField(4, 4, 11);
    expect(nativePack(g, 1, 0).status).toBe(WS_REJECTED);
    expect(nativePack(g, Number.NaN, 0.75).status).toBe(WS_REJECTED);
    expect(wasm.packSurfaceField(8, 8, 8, 0, 4097, 1, 1, 0.75, 8)).toBe(WS_REJECTED);
  });
});

describe('no per-cell JS loop uploads the SWE textures (#533 grep gate)', () => {
  const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');

  it('sweSurfaceField.ts packs nothing: no loop at all', () => {
    expect(read('sweSurfaceField.ts')).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|\.forEach\(/);
  });

  it('sweHost.ts walks no grid row / column and copies no plane into a texture', () => {
    const src = read('sweHost.ts');
    // A loop bounded by the grid's extent, or a texture backing array .set().
    expect(src).not.toMatch(/for\s*\([^)]*<\s*(?:grid|budget)\.(?:width|height)/);
    expect(src).not.toMatch(/\bfor\s*\(\s*let\s+g[xz]\b/);
    expect(src).not.toMatch(/image\.data[^;\n]*\)\.set\(/);
    expect(src).not.toMatch(/packSweSurfaceField/);
  });
});
