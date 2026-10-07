/**
 * The heightfield chore pipeline, synchronous over one CpuChoreHost:
 * reduce → histogram (over the reduced range) → downsample → separable blur.
 *
 * `heightfield.ts` runs the same sequence through the lane runtime on the
 * main thread; the sim worker runs this directly on its own module's live
 * `h` plane (CHORES), so a WebGL session needs no main-thread module for the
 * debug stats. No THREE / React here — the sim worker reaches this file.
 */
import type { CpuChoreHost } from './cpuBackend';

export const HEIGHTFIELD_THUMB_WIDTH = 32;

export interface HeightfieldSummary {
  min: number;
  max: number;
  mean: number;
  histogram: Uint32Array;
  thumb: { values: Float32Array; width: number; height: number };
}

export function heightfieldThumbSize(width: number, height: number): { width: number; height: number } {
  return {
    width: HEIGHTFIELD_THUMB_WIDTH,
    height: Math.max(1, Math.round((HEIGHTFIELD_THUMB_WIDTH * height) / width)),
  };
}

/**
 * `values` is read afresh for each step: a host allocation can grow the WASM
 * memory, which detaches a heap view captured before it.
 */
export function summarizeHeightfield(
  host: CpuChoreHost,
  values: () => Float32Array,
  width: number,
  height: number,
  thumbWidth: number,
  thumbHeight: number,
  useWasm: boolean,
): HeightfieldSummary {
  const reduce = host.reduceF32(values(), useWasm);
  const hist = host.histogramF32(values(), reduce.min, reduce.max, useWasm);
  const down = host.downsampleF32(values(), width, height, thumbWidth, thumbHeight, useWasm);
  const blurred = host.blurSeparableF32(down.values, down.width, down.height, useWasm);
  return {
    min: reduce.min,
    max: reduce.max,
    mean: reduce.mean,
    histogram: hist.bins,
    thumb: { values: blurred.values, width: blurred.width, height: blurred.height },
  };
}
