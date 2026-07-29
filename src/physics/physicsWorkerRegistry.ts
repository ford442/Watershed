/**
 * Cross-thread registry for the physics worker rollout.
 *
 * WaterForceSystem publishes tick params; RaftVehicle reads them when stepping
 * the worker so native water forces stay co-located with Rapier.
 */

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
}

const DEFAULT_TICK_PARAMS: PhysicsWorkerTickParams = {
  flowSpeed: 1.2,
  waterLevel: 0.5,
  turbulenceStrength: 0.1,
  turbulenceFrequency: 2.4,
  flowDirX: 0,
  flowDirZ: -1,
};

let workerActive = false;
let tickParams: PhysicsWorkerTickParams = { ...DEFAULT_TICK_PARAMS };
let latestDiagnostics: WaterForceDiagnostics | null = null;

export function setPhysicsWorkerActive(active: boolean): void {
  workerActive = active;
  if (!active) {
    latestDiagnostics = null;
  }
}

export function isPhysicsWorkerActive(): boolean {
  return workerActive;
}

export function setPhysicsWorkerTickParams(params: Partial<PhysicsWorkerTickParams>): void {
  tickParams = { ...tickParams, ...params };
}

export function getPhysicsWorkerTickParams(): PhysicsWorkerTickParams {
  return tickParams;
}

export function setPhysicsWorkerDiagnostics(diagnostics: WaterForceDiagnostics | null): void {
  latestDiagnostics = diagnostics;
}

export function getPhysicsWorkerDiagnostics(): WaterForceDiagnostics | null {
  return latestDiagnostics;
}

export function resetPhysicsWorkerRegistry(): void {
  workerActive = false;
  tickParams = { ...DEFAULT_TICK_PARAMS };
  latestDiagnostics = null;
}
