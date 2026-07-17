/**
 * SWEHeightField — shared shallow-water height field for visual deformation.
 *
 * WaterForceSystem owns the WASM grid and uploads a DataTexture each frame.
 * SplashSystem and other gameplay events enqueue disturbances via injectSWEDisturbance.
 */

import * as THREE from 'three';

export const SWE_GRID_WIDTH = 48;
export const SWE_GRID_HEIGHT = 32;
export const SWE_CELL_SIZE = 0.5;
export const SWE_MEAN_DEPTH = 1.0;

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
}

const pendingDisturbances: SWEDisturbance[] = [];

let snapshot: SWEHeightFieldSnapshot = {
  texture: null,
  originX: 0,
  originZ: 0,
  cellSize: SWE_CELL_SIZE,
  width: SWE_GRID_WIDTH,
  height: SWE_GRID_HEIGHT,
  enabled: false,
};

/** Queue a Gaussian bump at world XZ (consumed on the next SWE step). */
export function injectSWEDisturbance(
  worldX: number,
  worldZ: number,
  radius = 1.5,
  amplitude = 0.35,
): void {
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
  snapshot = {
    texture: null,
    originX: 0,
    originZ: 0,
    cellSize: SWE_CELL_SIZE,
    width: SWE_GRID_WIDTH,
    height: SWE_GRID_HEIGHT,
    enabled: false,
  };
  pendingDisturbances.length = 0;
}
