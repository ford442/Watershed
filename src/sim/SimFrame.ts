/**
 * SimFrame — what the sim worker publishes after a step (#455).
 *
 * One ArrayBuffer per frame holds the SWE planes the main thread reads, SoA in
 * swe.h order: η | u | w | b, `count = width * height` floats each. The bed is
 * in the frame because the solver writes it too (authored events carve it), so
 * the main thread's rasterized copy is only the input, not the field.
 *
 * Frames cross threads by transfer, not structured copy: the worker fills a
 * buffer from its pool and transfers it; the main thread copies it into its
 * stable mirror (workerSweSim.ts — readers hold those arrays across awaits, so
 * they must never be a transferable) and transfers it straight back
 * (`RETURN_FRAME`). Steady state is two pooled buffers and no allocation. The
 * worker copies OUT of the WASM heap into the frame on publish, so no view into
 * WASM memory ever crosses threads and a heap growth inside the worker cannot
 * detach a published frame.
 */

/** Planes per frame: η, u, w, b. */
export const SIM_FRAME_PLANES = 4;

export function simFrameByteLength(count: number): number {
  return SIM_FRAME_PLANES * count * Float32Array.BYTES_PER_ELEMENT;
}

export interface SimFramePlanes {
  /** Free-surface perturbation η (0 at rest) — swe.h `h`. */
  eta: Float32Array;
  u: Float32Array;
  w: Float32Array;
  b: Float32Array;
}

/** Views of one frame buffer. `buffer` must be `simFrameByteLength(count)` bytes. */
export function viewSimFrame(buffer: ArrayBuffer, count: number): SimFramePlanes {
  return {
    eta: new Float32Array(buffer, 0, count),
    u: new Float32Array(buffer, count * 4, count),
    w: new Float32Array(buffer, 2 * count * 4, count),
    b: new Float32Array(buffer, 3 * count * 4, count),
  };
}

/** Frame header; the planes travel in `buffer`. */
export interface SimFrameHeader {
  /** Grid the frame belongs to; a frame for a replaced grid is returned unread. */
  gridId: number;
  /** Monotonic per grid: one per published step. */
  frameIndex: number;
  /**
   * Scrolls + bed commits the worker had applied when it published. The main
   * thread scrolls its copy and rewrites its bed at once, so a frame from an
   * older epoch is in the old index frame or on the old bed and is discarded
   * (the WGSL readback in WgslSweSim.ts drops pre-scroll data the same way).
   */
  epoch: number;
  width: number;
  height: number;
  /** Wall time of the step (+ events) inside the worker, in microseconds. */
  computeMicros: number;
  backend: 'wasm-worker';
}

export interface SimFrame extends SimFrameHeader {
  buffer: ArrayBuffer;
}
