/**
 * waterForceAuthority.ts — exactly one gameplay water-force owner per raft tick.
 *
 * Worker, WaterForceSystem (main-thread ABI), and the raft local ABI fallback
 * all call calculateWaterForce / calculateWaterForceFallback. This helper is
 * the gate that keeps them from stacking in one physics tick.
 *
 * Authored WaterFlowForces *currents* are gated off while WaterForceSystem is
 * active (SWE u,w drives the ABI). Centering / seating / alignment and vortex
 * fields (until hydroEvents) stay separate gameplay systems.
 */

import {
  calculateWaterForceFallback,
  type NativeWaterForceConfig,
  type NativeWaterForceResult,
  type NativeWaterForceSample,
} from '../systems/water/WatershedWasm';

export type RaftWaterForceOwner = 'worker' | 'main-thread-abi' | 'local-abi';

/** Matches WaterForceSystem / physicsWorkerWaterForces impulse scaling. */
export const RAFT_WATER_FORCE_IMPULSE_SCALE = 0.001;

export function resolveRaftWaterForceOwner(opts: {
  workerPhysicsReady: boolean;
  waterForceSystemActive: boolean;
}): RaftWaterForceOwner {
  if (opts.workerPhysicsReady) return 'worker';
  if (opts.waterForceSystemActive) return 'main-thread-abi';
  return 'local-abi';
}

export function shouldApplyLocalAbiWaterForce(owner: RaftWaterForceOwner): boolean {
  return owner === 'local-abi';
}

/**
 * WaterForceSystem must not apply the vehicle impulse when the Rapier worker
 * already owns that body's water force this tick.
 */
export function shouldSkipMainThreadVehicleForce(
  isVehicle: boolean,
  workerActive: boolean,
): boolean {
  return isVehicle && workerActive;
}

export function localAbiWaterImpulse(
  force: Pick<NativeWaterForceResult, 'forceX' | 'forceY' | 'forceZ'>,
  delta: number,
  scale = RAFT_WATER_FORCE_IMPULSE_SCALE,
): { x: number; y: number; z: number } {
  return {
    x: force.forceX * delta * scale,
    y: force.forceY * delta * scale,
    z: force.forceZ * delta * scale,
  };
}

export interface LocalAbiWaterForceBody {
  translation: () => { x: number; y: number; z: number };
  linvel: () => { x: number; y: number; z: number };
  applyImpulse: (impulse: { x: number; y: number; z: number }, wake: boolean) => void;
}

/**
 * Apply calculateWaterForceFallback when this tick's owner is the local ABI.
 * Returns the force result when applied, otherwise null (no impulse).
 */
export function applyLocalAbiWaterForceIfOwner(
  owner: RaftWaterForceOwner,
  body: LocalAbiWaterForceBody,
  config: NativeWaterForceConfig,
  delta: number,
  flowDirection: { x: number; z: number } = { x: 0, z: -1 },
): NativeWaterForceResult | null {
  if (!shouldApplyLocalAbiWaterForce(owner)) return null;

  const pos = body.translation();
  const vel = body.linvel();
  const sample: NativeWaterForceSample = {
    position: { x: pos.x, y: pos.y, z: pos.z },
    velocity: { x: vel.x, y: vel.y, z: vel.z },
    flowDirection,
  };
  const force = calculateWaterForceFallback(sample, config);
  if (force.submergedRatio <= 0) return force;

  body.applyImpulse(localAbiWaterImpulse(force, delta), true);
  return force;
}
