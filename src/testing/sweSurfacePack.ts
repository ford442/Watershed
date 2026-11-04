/**
 * Test-only: no production module imports this.
 *
 * `packSurfaceField` (emscripten/chores.cpp) written out per cell with every
 * operation rounded to float32 in the C++ order — the statement the native
 * bytes are pinned to (sweSurfaceField.drift.test.ts), and the JS stand-in
 * the heap-backed module stubs use for the export (#533).
 */
import { SWE_DRY_DEPTH } from '../systems/water/sampleSWEFlow';
import { SWE_FLOW_CHANNELS } from '../systems/water/sweSurfaceField';

const f = Math.fround;
const DRY = f(SWE_DRY_DEPTH);

export interface SurfacePlanes {
  h: ArrayLike<number>;
  u: ArrayLike<number>;
  w: ArrayLike<number>;
  /** null: a flat bed (`bPtr` 0). */
  b: ArrayLike<number> | null;
}

/** RGBA (u, w, depth, div) per cell into `out` (4 · width · height floats). */
export function referencePackSurface(
  { h, u, w, b }: SurfacePlanes,
  width: number,
  height: number,
  H: number,
  dx: number,
  out: Float32Array = new Float32Array(width * height * SWE_FLOW_CHANNELS),
): Float32Array {
  const Hf = f(H);
  const dxf = f(dx);
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = z * width + x;
      const depth = Math.max(0, f(f(Hf + h[i]) - (b ? b[i] : 0)));
      let div = 0;
      if (depth > DRY) {
        const xLo = x > 0 ? x - 1 : x;
        const xHi = x < width - 1 ? x + 1 : x;
        const zLo = z > 0 ? z - 1 : z;
        const zHi = z < height - 1 ? z + 1 : z;
        const spanX = f((xHi - xLo) * dxf);
        const spanZ = f((zHi - zLo) * dxf);
        if (spanX > 0) div = f(div + f(f(u[z * width + xHi] - u[z * width + xLo]) / spanX));
        if (spanZ > 0) div = f(div + f(f(w[zHi * width + x] - w[zLo * width + x]) / spanZ));
      }
      const o = i * SWE_FLOW_CHANNELS;
      out[o] = u[i];
      out[o + 1] = w[i];
      out[o + 2] = depth;
      out[o + 3] = div;
    }
  }
  return out;
}

/** `ws_packSurfaceField` over a stub's heap: the reference above, returning WS_OK. */
export function packSurfaceFieldStub(heap: Float32Array) {
  return (hp: number, up: number, wp: number, bp: number, width: number, height: number, H: number, dx: number, op: number): number => {
    const n = width * height;
    const view = (p: number, c: number) => new Float32Array(heap.buffer, p, c);
    referencePackSurface(
      { h: view(hp, n), u: view(up, n), w: view(wp, n), b: bp ? view(bp, n) : null },
      width, height, H, dx, view(op, SWE_FLOW_CHANNELS * n),
    );
    return 1;
  };
}
