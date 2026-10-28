/**
 * VehicleSystem.ts — what is left of the vehicle class layer (#521 F): the
 * surface / friction table, the impact tracker both vehicles share, and the
 * raft's A/D steer.
 *
 * The old `BaseVehicle` / `RunnerVehicle` / `RaftVehicle` hierarchy is gone.
 * Its `update()` ran only for the raft's steer, `onCollision` had no
 * subscribers, `getConfig()` was read for one number (the runner's contact
 * friction), and `setSurfaceMaterial` wrote friction to a `body.colliders`
 * field Rapier bodies do not have — so per-biome friction was never applied,
 * and removing it changes nothing in play. The surface still picks the impact
 * sound and burst (`GameplayProfile.surface`).
 */

import type * as THREE from 'three';
import { gameEvents } from '../events/GameEvents';
import type { SurfaceMaterial } from './surfaceMaterial';

export { SurfaceMaterial, MATERIAL_FRICTION } from './surfaceMaterial';

/** The runner capsule's contact friction off a slide or a bank (was RunnerVehicle's config). */
export const RUNNER_CONTACT_FRICTION = 0.04;

/** Impacts closer together than this (sim seconds) make one event. */
export const COLLISION_COOLDOWN_SEC = 0.1;

/** Impact force above which an impact throws a particle burst. */
export const HIGH_IMPACT_FORCE = 5;

/**
 * Rate-limited impact events for one vehicle, on the vehicle's own sim clock
 * (`advanceClock` once per step with its delta — never wall time).
 */
export interface CollisionTracker {
  advanceClock(delta: number): void;
  /** `advanceClock(step.dt)`, reading the delta from a field (no boxed argument on the runner's hot path). */
  advanceClockBy(step: { readonly dt: number }): void;
  /** Report an impact; emits `collision-sound` unless one fired within the cooldown. */
  processCollision(material: SurfaceMaterial, impactForce: number, contactPoint: THREE.Vector3): void;
  /** True when an impact is hard enough for the particle burst. */
  isHighImpact(impactForce: number): boolean;
}

export function createCollisionTracker(): CollisionTracker {
  // Object fields, not closure variables: a double kept in a closure is boxed
  // afresh on every write, and advanceClock runs every step (#521 D).
  const clock = { simTimeSec: 0, lastCollisionSec: Number.NEGATIVE_INFINITY };
  return {
    advanceClock(delta) {
      if (Number.isFinite(delta) && delta > 0) clock.simTimeSec += delta;
    },
    advanceClockBy(step) {
      if (Number.isFinite(step.dt) && step.dt > 0) clock.simTimeSec += step.dt;
    },
    processCollision(material, impactForce, contactPoint) {
      if (clock.simTimeSec - clock.lastCollisionSec < COLLISION_COOLDOWN_SEC) return;
      clock.lastCollisionSec = clock.simTimeSec;
      // F1: collision sound (useExperienceLifecycle plays collide_<material>).
      gameEvents.emit('collision-sound', {
        material,
        force: impactForce,
        point: { x: contactPoint.x, y: contactPoint.y, z: contactPoint.z },
      });
    },
    isHighImpact(impactForce) {
      return impactForce > HIGH_IMPACT_FORCE;
    },
  };
}

/** The raft's A/D steer: lateral impulse, yaw torque, then the downstream speed cap. */
export const RAFT_STEER = {
  /** Lateral impulse per second at full input (the old config's baseSpeed 18 × 0.4). */
  speed: 18 * 0.4,
  /** Yaw torque impulse per second at full input. */
  torque: 3,
  /** |vz| cap, m/s. */
  maxSpeedZ: 20,
} as const;

interface SteerableBody {
  applyImpulse(impulse: { x: number; y: number; z: number }, wake: boolean): void;
  applyTorqueImpulse(torque: { x: number; y: number; z: number }, wake: boolean): void;
  linvel(): { x: number; y: number; z: number };
  setLinvel(vel: { x: number; y: number; z: number }, wake: boolean): void;
}

const _steer = { x: 0, y: 0, z: 0 };

/** One step of raft steering (`moveX` −1 left … 1 right). */
export function applyRaftSteer(body: SteerableBody, moveX: number, delta: number): void {
  if (moveX !== 0) {
    _steer.x = moveX * RAFT_STEER.speed * delta;
    _steer.y = 0;
    _steer.z = 0;
    body.applyImpulse(_steer, true);
    _steer.x = 0;
    _steer.y = -moveX * RAFT_STEER.torque * delta;
    body.applyTorqueImpulse(_steer, true);
  }
  const vel = body.linvel();
  if (Math.abs(vel.z) > RAFT_STEER.maxSpeedZ) {
    _steer.x = vel.x;
    _steer.y = vel.y;
    _steer.z = RAFT_STEER.maxSpeedZ * Math.sign(vel.z);
    body.setLinvel(_steer, true);
  }
}
