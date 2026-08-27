/**
 * sweBedDebug — publishes the sampled SWE bed for the `?sweDebug=1` overlay.
 *
 * Kept separate from SWEHeightField so the render path never pays for it: the
 * bed is only republished when it is actually re-rasterized (a window slide or
 * a treadmill change), not per frame.
 */

import { SWE_MEAN_DEPTH } from './SWEHeightField';

export interface SWEBedSnapshot {
  /** Copy of the bed field, `b` in `emscripten/swe.h` terms. */
  bed: Float32Array;
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
  /** Cells a registered canyon segment actually covered. */
  coveredCells: number;
  sourceCount: number;
}

type Listener = (snapshot: SWEBedSnapshot | null) => void;

let current: SWEBedSnapshot | null = null;
const listeners = new Set<Listener>();

export function publishSWEBedSnapshot(snapshot: Omit<SWEBedSnapshot, 'bed'> & { bed: Float32Array }): void {
  // Copy: `bed` is a live view into the WASM heap, which a later grow would
  // detach out from under the overlay.
  current = { ...snapshot, bed: Float32Array.from(snapshot.bed) };
  for (const listener of listeners) listener(current);
}

export function clearSWEBedSnapshot(): void {
  if (!current) return;
  current = null;
  for (const listener of listeners) listener(null);
}

export function getSWEBedSnapshot(): SWEBedSnapshot | null {
  return current;
}

export function subscribeSWEBedSnapshot(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

/** Fraction of cells that hold water at rest (depth = H − b > 0). */
export function wetFraction(snapshot: SWEBedSnapshot): number {
  const { bed } = snapshot;
  if (bed.length === 0) return 0;
  let wet = 0;
  for (let i = 0; i < bed.length; i += 1) {
    if (SWE_MEAN_DEPTH - bed[i] > 1e-4) wet += 1;
  }
  return wet / bed.length;
}
