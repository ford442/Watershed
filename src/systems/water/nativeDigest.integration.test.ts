// @vitest-environment node
/**
 * nativeDigest.integration.test.ts — the shipped wasm computes the host's
 * numbers bit for bit.
 *
 * Replays the scenarios of emscripten/native_digest.h through the committed
 * pair and compares an FNV-1a digest of every output float's bits with the
 * digests in that header, which host_smoke.cpp checks against the host
 * build. A match means wasm == host exactly, not within a tolerance; it is
 * what the Release flags (no -ffast-math) have to keep true. Every input is
 * exact in float32 and in a double, so both sides start from the same bits.
 *
 * Runs in `pnpm test` (the committed pair) and in `pnpm test:wasm` after CI's
 * pinned rebuild. A scenario change goes into both files, then
 * `WATERSHED_PRINT_DIGESTS=1 emscripten/build-host/watershed_host_smoke`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { ROUTING_SUBREACHES, type WatershedNativeModule } from './wasmAbi';
import { loadNativeFromDisk } from '../../testing/nativeFromDisk';

const HEADER = readFileSync(resolve(__dirname, '../../../emscripten/native_digest.h'), 'utf8');

function expected(name: string): number {
  const m = new RegExp(`${name} = 0x([0-9a-f]{8})u;`).exec(HEADER);
  if (!m) throw new Error(`native_digest.h has no ${name}`);
  return Number.parseInt(m[1], 16);
}

const hex = (v: number) => `0x${v.toString(16).padStart(8, '0')}`;

/** FNV-1a over 32-bit words, low byte first: native_digest.h `Fnv`. */
class Fnv {
  h = 0x811c9dc5;
  private readonly f32 = new Float32Array(1);
  private readonly u32 = new Uint32Array(this.f32.buffer);

  word(v: number): void {
    for (let i = 0; i < 4; i += 1) {
      this.h = Math.imul((this.h ^ ((v >>> (8 * i)) & 0xff)) >>> 0, 0x01000193) >>> 0;
    }
  }

  float(v: number): void {
    this.f32[0] = v;
    this.word(this.u32[0]);
  }

  floats(v: Float32Array): void {
    const bits = new Uint32Array(v.buffer, v.byteOffset, v.length);
    for (const b of bits) this.word(b);
  }
}

let wasm: WatershedNativeModule;

beforeAll(async () => {
  wasm = await loadNativeFromDisk();
});

/** A heap block of `count` floats; `view()` re-reads it through the live heap. */
function block(count: number) {
  const ptr = wasm.allocateGrid(count);
  return {
    ptr,
    view: () => new Float32Array(wasm.HEAPF32.buffer, ptr, count),
    free: () => wasm.freeGrid(ptr),
  };
}

function sweDigest(): number {
  const W = 40;
  const Z = 24;
  const N = W * Z;
  const dx = 0.5;
  const g = 9.80665;
  const H = 1;
  const [h, u, w, b] = [block(N), block(N), block(N), block(N)];
  let s = 0x9e3779b9;
  const next = () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s;
  };
  const hv = h.view();
  const uv = u.view();
  const wv = w.view();
  const bv = b.view();
  for (let i = 0; i < N; i += 1) {
    const r = next();
    bv[i] = (r & 0xff) * 2 ** -9;
    hv[i] = (((r >>> 8) & 0xfff) - 2048) * 2 ** -14;
    uv[i] = (((r >>> 20) & 0x3ff) - 512) * 2 ** -9;
    wv[i] = ((next() & 0x3ff) - 512) * 2 ** -9;
  }
  wasm.reserveShallowWaterScratch(W, Z);
  for (let k = 0; k < 30; k += 1) {
    if (k % 2 === 0) {
      wasm.stepShallowWaterInflow(h.ptr, u.ptr, w.ptr, b.ptr, W, Z, 0.02, g, dx, H, 0.15);
    } else {
      wasm.stepShallowWater(h.ptr, u.ptr, w.ptr, b.ptr, W, Z, 0.02, g, dx, H);
    }
    if (k === 8) {
      for (let kind = 0; kind <= 4; kind += 1) {
        wasm.applySWEEvent(h.ptr, u.ptr, w.ptr, b.ptr, W, Z, dx, -10, -6, H, kind, -6 + 3 * kind, 0, 2.5, 0.75, 0.02);
      }
    }
    if (k === 16) wasm.scrollShallowWater(h.ptr, u.ptr, w.ptr, b.ptr, W, Z, 1, -2, 0.0625, 0.125, -0.25);
  }
  const f = new Fnv();
  for (const p of [h, u, w, b]) f.floats(p.view());
  for (const p of [h, u, w, b]) p.free();
  return f.h;
}

function routingDigest(): number {
  const n = 20;
  const [L, S, B, lateral, storage, outflow, lag] =
    [block(n), block(n), block(n), block(n), block(n * ROUTING_SUBREACHES), block(n), block(n)];
  for (let k = 0; k < n; k += 1) {
    L.view()[k] = 95 + 2 * (k % 5);
    S.view()[k] = (6 + (k % 3)) * 2 ** -8;
    B.view()[k] = 10 + (k % 4);
    lateral.view()[k] = k % 3 === 0 ? 0.5 : 0;
  }
  wasm.routeReachSteady(L.ptr, S.ptr, B.ptr, n, 40, storage.ptr, outflow.ptr);
  for (let t = 0; t < 60; t += 1) {
    const q = t % 20 < 10 ? 54 : 40;
    if (t % 2 === 1) {
      wasm.routeReachLateral(L.ptr, S.ptr, B.ptr, n, q, lateral.ptr, 1, storage.ptr, outflow.ptr);
    } else {
      wasm.routeReach(L.ptr, S.ptr, B.ptr, n, q, 1, storage.ptr, outflow.ptr);
    }
  }
  wasm.routeReachTravelTime(L.ptr, S.ptr, B.ptr, n, 40, lag.ptr);
  const f = new Fnv();
  f.floats(storage.view());
  f.floats(outflow.view());
  f.floats(lag.view());
  for (const q of outflow.view()) {
    const e = wasm.routedEdgeState(q, 40, 1, 9.80665);
    f.float(e.eta);
    f.float(e.speed);
  }
  for (const p of [L, S, B, lateral, storage, outflow, lag]) p.free();
  return f.h;
}

describe('shipped wasm == host build, bit for bit (native_digest.h)', () => {
  it.each([
    ['SWE step / inflow step / events / scroll', 'kSweDigest', sweDigest],
    ['routing: steady, routed + lateral steps, travel time, edge state', 'kRoutingDigest', routingDigest],
  ] as const)('%s', (_label, name, digest) => {
    expect(hex(digest())).toBe(hex(expected(name)));
  });
});
