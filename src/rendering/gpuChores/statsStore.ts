/**
 * Cross-Canvas gpu-chores stats bus. DebugPanel subscribes; WaterForceSystem publishes.
 */

import type { ChoreBackend } from './types';

export interface GpuChoreStats {
  backend: ChoreBackend | null;
  reason: string | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  histogram: Uint32Array | null;
  thumb: { values: Float32Array; width: number; height: number } | null;
}

const EMPTY: GpuChoreStats = {
  backend: null,
  reason: null,
  min: null,
  max: null,
  mean: null,
  histogram: null,
  thumb: null,
};

let stats: GpuChoreStats = { ...EMPTY };
const listeners = new Set<() => void>();

function publish(next: Partial<GpuChoreStats>): void {
  const merged: GpuChoreStats = { ...stats, ...next };
  let changed = false;
  (Object.keys(merged) as (keyof GpuChoreStats)[]).forEach((key) => {
    if (merged[key] !== stats[key]) changed = true;
  });
  if (!changed) return;
  stats = merged;
  for (const listener of listeners) listener();
}

export function setGpuChoreStats(next: Partial<GpuChoreStats>): void {
  publish(next);
}

export function getGpuChoreStats(): GpuChoreStats {
  return stats;
}

export function subscribeGpuChoreStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetGpuChoreStats(): void {
  stats = { ...EMPTY };
  for (const listener of listeners) listener();
}
