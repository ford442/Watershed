/**
 * SWEHeightField — shared shallow-water height field for visual deformation.
 *
 * WaterForceSystem owns the WASM grid and uploads a DataTexture each frame.
 * SplashSystem and other gameplay events enqueue disturbances via injectSWEDisturbance.
 *
 * The grid is quality-budgeted (see sweQuality.ts): on the `low` preset the whole
 * path is off, and `setSWEActiveBudget` makes disturbance injection a no-op so
 * splash events don't grow an unbounded queue nobody drains.
 */

import * as THREE from 'three';
import { sweBudgetForQuality, type SWEBudget } from './sweQuality';

/** Baseline (high-preset) grid — kept as the historical default for consumers. */
export const SWE_GRID_WIDTH = 48;
export const SWE_GRID_HEIGHT = 32;
export const SWE_CELL_SIZE = 0.5;
export const SWE_MEAN_DEPTH = 1.0;

/** Cap on queued disturbances, so a stalled consumer can't grow the queue forever. */
const MAX_PENDING_DISTURBANCES = 64;

export interface SWEDisturbance {
  worldX: number;
  worldZ: number;
  radius: number;
  amplitude: number;
}

export interface SWEHeightFieldSnapshot {
  texture: THREE.DataTexture | null;
  originX: number;
  originZ: number;
  cellSize: number;
  width: number;
  height: number;
  enabled: boolean;
  /** Vertex displacement scale for the water shader (quality-budgeted). */
  displacementScale: number;
}

const pendingDisturbances: SWEDisturbance[] = [];

/** The budget WaterForceSystem is currently running. */
let activeBudget: SWEBudget = sweBudgetForQuality('high');

const emptySnapshot = (): SWEHeightFieldSnapshot => ({
  texture: null,
  originX: 0,
  originZ: 0,
  cellSize: activeBudget.cellSize || SWE_CELL_SIZE,
  width: activeBudget.width || SWE_GRID_WIDTH,
  height: activeBudget.height || SWE_GRID_HEIGHT,
  enabled: false,
  displacementScale: activeBudget.displacementScale,
});

let snapshot: SWEHeightFieldSnapshot = emptySnapshot();

/**
 * Publish the budget WaterForceSystem is running. When the budget is disabled,
 * queued disturbances are dropped and new ones are ignored.
 */
export function setSWEActiveBudget(budget: SWEBudget): void {
  activeBudget = budget;
  if (!budget.enabled) {
    pendingDisturbances.length = 0;
  }
}

export function getSWEActiveBudget(): SWEBudget {
  return activeBudget;
}

/** Queue a Gaussian bump at world XZ (consumed on the next SWE step). */
export function injectSWEDisturbance(
  worldX: number,
  worldZ: number,
  radius = 1.5,
  amplitude = 0.35,
): void {
  if (!activeBudget.enabled) return;
  if (pendingDisturbances.length >= MAX_PENDING_DISTURBANCES) return;
  pendingDisturbances.push({ worldX, worldZ, radius, amplitude });
}

/** Drain and return queued disturbances for the current frame. */
export function consumeSWEDisturbances(): SWEDisturbance[] {
  if (pendingDisturbances.length === 0) return [];
  const batch = pendingDisturbances.splice(0, pendingDisturbances.length);
  return batch;
}

export function getSWEHeightFieldSnapshot(): SWEHeightFieldSnapshot {
  return snapshot;
}

export function updateSWEHeightFieldSnapshot(next: Partial<SWEHeightFieldSnapshot>): void {
  snapshot = { ...snapshot, ...next };
}

export function clearSWEHeightField(): void {
  if (snapshot.texture) {
    snapshot.texture.dispose();
  }
  snapshot = emptySnapshot();
  pendingDisturbances.length = 0;
}
