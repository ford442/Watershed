/**
 * Cross-thread registry for the physics worker rollout.
 *
 * WaterForceSystem publishes tick params; RaftVehicle reads them when stepping
 * the worker so native water forces stay co-located with Rapier.
 *
 * It also carries the debug-facing status bus (worker on/off + why, which force
 * path ran, last batch cost, SWE budget) so DebugPanel can render live state
 * without reaching into the worker.
 */

import type { PhysicsWorkerReason } from '../utils/physicsWorkerFlag';

export interface PhysicsWorkerTickParams {
  flowSpeed: number;
  waterLevel: number;
  turbulenceStrength: number;
  turbulenceFrequency: number;
  flowDirX: number;
  flowDirZ: number;
}

export interface WaterForceDiagnostics {
  source: 'wasm' | 'fallback' | 'disabled';
  forceX: number;
  forceY: number;
  forceZ: number;
  buoyancy: number;
  drag: number;
  flow: number;
  turbulence: number;
  submergedRatio: number;
  /** Wall time of the force batch inside the worker, in microseconds. */
  computeMicros?: number;
}

/** Snapshot rendered by DebugPanel. */
export interface PhysicsWorkerStatus {
  /** Worker path resolved as enabled for this session. */
  enabled: boolean;
  /** Why it resolved that way (query param, setting, capability, default). */
  reason: PhysicsWorkerReason | null;
  /** Worker is live and stepping (false while it boots or after a failure). */
  active: boolean;
  /** Which force math produced the last tick. */
  path: 'wasm' | 'fallback' | 'off';
  /** Last force-batch cost reported by the worker, in microseconds. */
  lastBatchMicros: number | null;
  /** SWE visual displacement currently running (quality-gated). */
  sweEnabled: boolean;
  /** Active SWE grid, e.g. '48x32' — null when SWE is off. */
  sweGrid: string | null;
}

const DEFAULT_TICK_PARAMS: PhysicsWorkerTickParams = {
  flowSpeed: 1.2,
  waterLevel: 0.5,
  turbulenceStrength: 0.1,
  turbulenceFrequency: 2.4,
  flowDirX: 0,
  flowDirZ: -1,
};

const DEFAULT_STATUS: PhysicsWorkerStatus = {
  enabled: false,
  reason: null,
  active: false,
  path: 'off',
  lastBatchMicros: null,
  sweEnabled: false,
  sweGrid: null,
};

let workerActive = false;
let tickParams: PhysicsWorkerTickParams = { ...DEFAULT_TICK_PARAMS };
let latestDiagnostics: WaterForceDiagnostics | null = null;
let status: PhysicsWorkerStatus = { ...DEFAULT_STATUS };

const statusListeners = new Set<() => void>();

function publishStatus(next: Partial<PhysicsWorkerStatus>): void {
  const merged = { ...status, ...next };
  // Reference equality drives useSyncExternalStore — skip no-op updates so a
  // per-frame diagnostics push doesn't re-render the panel on unchanged data.
  let changed = false;
  for (const key of Object.keys(merged) as (keyof PhysicsWorkerStatus)[]) {
    if (merged[key] !== status[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  status = merged;
  for (const listener of statusListeners) listener();
}

export function setPhysicsWorkerActive(active: boolean): void {
  workerActive = active;
  if (!active) {
    latestDiagnostics = null;
  }
  publishStatus({
    active,
    path: active ? status.path : 'off',
    lastBatchMicros: active ? status.lastBatchMicros : null,
  });
}

export function isPhysicsWorkerActive(): boolean {
  return workerActive;
}

/** Record the resolved enable decision (called once when the vehicle mounts). */
export function setPhysicsWorkerDecision(
  enabled: boolean,
  reason: PhysicsWorkerReason,
): void {
  publishStatus({ enabled, reason });
}

/** Publish the SWE visual budget currently in force (quality-gated). */
export function setSWEStatus(enabled: boolean, grid: string | null): void {
  publishStatus({ sweEnabled: enabled, sweGrid: enabled ? grid : null });
}

export function getPhysicsWorkerStatus(): PhysicsWorkerStatus {
  return status;
}

export function subscribePhysicsWorkerStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function setPhysicsWorkerTickParams(params: Partial<PhysicsWorkerTickParams>): void {
  tickParams = { ...tickParams, ...params };
}

export function getPhysicsWorkerTickParams(): PhysicsWorkerTickParams {
  return tickParams;
}

export function setPhysicsWorkerDiagnostics(diagnostics: WaterForceDiagnostics | null): void {
  latestDiagnostics = diagnostics;
  if (!diagnostics) return;
  publishStatus({
    path: diagnostics.source === 'disabled' ? 'off' : diagnostics.source,
    lastBatchMicros:
      typeof diagnostics.computeMicros === 'number'
        ? Math.round(diagnostics.computeMicros)
        : status.lastBatchMicros,
  });
}

export function getPhysicsWorkerDiagnostics(): WaterForceDiagnostics | null {
  return latestDiagnostics;
}

export function resetPhysicsWorkerRegistry(): void {
  workerActive = false;
  tickParams = { ...DEFAULT_TICK_PARAMS };
  latestDiagnostics = null;
  status = { ...DEFAULT_STATUS };
  for (const listener of statusListeners) listener();
}
