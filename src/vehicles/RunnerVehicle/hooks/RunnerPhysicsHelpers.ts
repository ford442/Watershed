import * as THREE from 'three';
import { SurfaceMaterial, MATERIAL_FROM_BIOME } from '../../../systems/vehicle/VehicleSystem';
import { MOVEMENT } from '../../../constants/game';
import { useGameStore } from '../../../systems/GameState';
import {
  RAYCAST_DISTANCE,
  GROUND_RAY_MIN_TOI,
  RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET,
  SLOPE_RANGES,
  NEAR_MISS_SPEED_THRESHOLD,
  NEAR_MISS_RAY_LENGTH,
  NEAR_MISS_TOI_MIN,
  NEAR_MISS_TOI_MAX,
} from '../constants';
import { playDodgeSound } from '../audio';
import { triggerCameraShake } from '../utils';
import { hasActiveLaunch, recordLaunchWallContact } from '../../../systems/score/LaunchScoringSession';
import { emitCollisionBurst } from '../../../components/CollisionParticles';
import { gameEvents } from '../../../systems/events/GameEvents';
import {
  bodyUserData,
  type RapierBody,
  type RapierNamespace,
  type RapierRay,
  type RapierRayHit,
  type RapierWorldQueries,
  type Vec3Like,
} from '../../../physics/rapierTypes';
import type { RunnerVehicle as RunnerVehicleClass } from '../../../systems/vehicle/VehicleSystem';
import type { RunnerPhysicsState } from './useRunnerPhysics';

// Per-step scratch (#503 B): these helpers run inside useFrame every physics
// step, where `new` is invisible to @react-three/no-new-in-loop.
const _velocityDelta = new THREE.Vector3();
const _contactPoint = new THREE.Vector3();
const _relativeVelocity = new THREE.Vector3();
const _forwardDir = new THREE.Vector3();
const _rightDir = new THREE.Vector3();
const _sideDir = new THREE.Vector3();
const scratchRays = new WeakMap<object, RapierRay>();

/**
 * The one reusable Rapier `Ray` per Rapier namespace, set to origin `o` and
 * direction `d`. A Rapier ray is plain JS data read during `castRay`; callers
 * cast with it immediately and never keep (or free) it.
 */
export function scratchRay(
  rapier: Pick<RapierNamespace, 'Ray'>,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
): RapierRay {
  let ray = scratchRays.get(rapier);
  if (!ray) {
    ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    scratchRays.set(rapier, ray);
  }
  ray.origin.x = ox;
  ray.origin.y = oy;
  ray.origin.z = oz;
  ray.dir.x = dx;
  ray.dir.y = dy;
  ray.dir.z = dz;
  return ray;
}

export function getRayTimeOfImpact(hit: RapierRayHit | null | undefined): number | null {
  if (!hit) return null;
  const toi = typeof hit.timeOfImpact === 'function' ? hit.timeOfImpact() : hit.timeOfImpact;
  return typeof toi === 'number' && Number.isFinite(toi) ? toi : null;
}

/** Downward ground ray that excludes the player's rigid body (avoids capsule self-hit at TOI 0). */
export function castPlayerGroundRay(
  world: RapierWorldQueries,
  rapier: Pick<RapierNamespace, 'Ray'>,
  body: unknown,
  origin: { x: number; y: number; z: number },
  maxDist: number = RAYCAST_DISTANCE,
): { hit: RapierRayHit | null; toi: number | null } {
  const ray = scratchRay(rapier, origin.x, origin.y, origin.z, 0, -1, 0);
  const hit = body
    ? world.castRay(ray, maxDist, true, undefined, undefined, undefined, body)
    : world.castRay(ray, maxDist, true);
  return { hit, toi: getRayTimeOfImpact(hit) };
}

export function isTerrainGroundHit(toi: number | null): boolean {
  return toi !== null && toi >= GROUND_RAY_MIN_TOI && toi <= RAYCAST_DISTANCE;
}

export function calculateSlopeAngle({
  body,
  world,
  rapier,
  slopeState,
}: {
  body: RapierBody;
  world: RapierWorldQueries;
  rapier: Pick<RapierNamespace, 'Ray'>;
  slopeState: RunnerPhysicsState['slopeState'];
}): number {
  if (!body || !world) return 0;

  const pos = body.translation();

  // Primary path: use castRayAndGetNormal to obtain the true trimesh face normal.
  // This gives accurate per-triangle surface orientation on the canyon walls and U-banks,
  // which the height-gradient fallback cannot capture for near-vertical faces.
  // Note: castRayAndGetNormal exists in rapier3d-compat 0.19+ but @react-three/rapier's
  // TypeScript types may not declare it, hence the optional member on RapierWorldQueries.
  const centerNormalRay = scratchRay(rapier, pos.x, pos.y + RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET, pos.z, 0, -1, 0);
  const normalHit = world.castRayAndGetNormal
    ? world.castRayAndGetNormal(
        centerNormalRay,
        RAYCAST_DISTANCE,
        true,
        undefined,
        undefined,
        undefined,
        body,
      )
    : null;

  const normalToi = getRayTimeOfImpact(normalHit);
  if (normalHit && isTerrainGroundHit(normalToi)) {
    const n: Vec3Like = normalHit.normal ?? (normalHit as unknown as Vec3Like);
    const nLen = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
    if (nLen > 0.001) {
      slopeState.current.lastGroundNormal.set(n.x / nLen, n.y / nLen, n.z / nLen);
    }
    normalHit.free?.();

    const gn = slopeState.current.lastGroundNormal;
    // Bank angle: atan2(gn.x, gn.y) gives the lateral tilt of the surface normal.
    // Positive = normal leans toward +X (left wall tilts toward player from right side),
    // negative = normal leans toward -X.
    slopeState.current.bankAngle = (Math.atan2(gn.x, gn.y) * 180) / Math.PI;
    // Pitch angle: forward/back slope; keep existing sign convention (negative = downhill forward)
    const pitchAngleRad = Math.atan2(-gn.z, gn.y);
    const angleDeg = (pitchAngleRad * 180) / Math.PI;
    return Math.max(-60, Math.min(60, angleDeg));
  }

  // Fallback: five-point height-gradient sampling when castRayAndGetNormal unavailable
  const rayLength = RAYCAST_DISTANCE;
  const castRay = (offsetX: number, offsetZ: number): number | null => {
    const originY = pos.y + RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET;
    const ray = scratchRay(rapier, pos.x + offsetX, originY, pos.z + offsetZ, 0, -1, 0);
    const hit = world.castRay(ray, rayLength, true, undefined, undefined, undefined, body);
    const toi = getRayTimeOfImpact(hit);
    if (hit && typeof hit.free === 'function') hit.free();
    if (!isTerrainGroundHit(toi)) return null;
    return originY - toi!;
  };

  const sampleDist = 0.5;
  const hCenter = castRay(0, 0);
  const hForward = castRay(0, -sampleDist);
  const hBack = castRay(0, sampleDist);

  if (hCenter === null) return 0;

  const hLeft = castRay(-sampleDist, 0);
  const hRight = castRay(sampleDist, 0);

  let slopeZ = 0;
  let samples = 0;

  if (hForward !== null) {
    slopeZ += (hForward - hCenter) / sampleDist;
    samples++;
  }
  if (hBack !== null) {
    slopeZ += (hCenter - hBack) / sampleDist;
    samples++;
  }

  if (samples === 0) return 0;

  slopeZ /= samples;

  let slopeX = 0;
  let samplesX = 0;
  if (hLeft !== null) { slopeX += (hLeft - hCenter) / sampleDist; samplesX++; }
  if (hRight !== null) { slopeX += (hCenter - hRight) / sampleDist; samplesX++; }
  if (samplesX > 0) slopeX /= samplesX;

  // Store bank angle from height gradient
  slopeState.current.bankAngle = (Math.atan(slopeX) * 180) / Math.PI;

  const nx = -slopeX;
  const ny = 1.0;
  const nz = -slopeZ;
  const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nLen > 0.001) {
    slopeState.current.lastGroundNormal.set(nx / nLen, ny / nLen, nz / nLen);
  }

  const angleRad = Math.atan(slopeZ);
  let angleDeg = (angleRad * 180) / Math.PI;
  angleDeg = Math.max(-60, Math.min(60, angleDeg));

  return angleDeg;
}

export function calculateSlopeMultiplier(angle: number): number {
  if (Math.abs(angle) <= SLOPE_RANGES.FLAT.max) {
    return SLOPE_RANGES.FLAT.multiplier;
  }

  if (angle > SLOPE_RANGES.FLAT.max && angle <= SLOPE_RANGES.GENTLE_DOWNSLOPE.max) {
    const t = (angle - SLOPE_RANGES.GENTLE_DOWNSLOPE.min) /
              (SLOPE_RANGES.GENTLE_DOWNSLOPE.max - SLOPE_RANGES.GENTLE_DOWNSLOPE.min);
    return THREE.MathUtils.lerp(
      SLOPE_RANGES.GENTLE_DOWNSLOPE.minMult,
      SLOPE_RANGES.GENTLE_DOWNSLOPE.maxMult,
      t
    );
  }

  if (angle > SLOPE_RANGES.GENTLE_DOWNSLOPE.max) {
    return SLOPE_RANGES.STEEP_DOWNSLOPE.multiplier;
  }

  if (angle < 0 && angle >= SLOPE_RANGES.UPSLOPE.min) {
    const t = Math.abs(angle) / Math.abs(SLOPE_RANGES.UPSLOPE.min);
    return THREE.MathUtils.lerp(
      SLOPE_RANGES.UPSLOPE.maxMult,
      SLOPE_RANGES.UPSLOPE.minMult,
      t
    );
  }

  if (angle < SLOPE_RANGES.UPSLOPE.min) {
    return SLOPE_RANGES.STEEP_UPSLOPE.multiplier;
  }

  return 1.0;
}

export function handleDodgeAndCollision({
  dodgeState,
  dodgeJustPressed,
  isGrounded,
  camera,
  leftward,
  rightward,
  backward,
  dt,
  body,
  pos,
  vel,
  prevFrame,
  vehicle,
  collisionState,
  debugState,
  now,
  applyImpulseWithDebugTracking,
  rapier,
  world,
}: {
  dodgeState: RunnerPhysicsState['dodgeState'];
  dodgeJustPressed: boolean;
  isGrounded: boolean;
  camera: THREE.Camera;
  leftward: boolean;
  rightward: boolean;
  backward: boolean;
  dt: number;
  body: RapierBody;
  pos: Vec3Like;
  vel: Vec3Like;
  prevFrame: RunnerPhysicsState['prevFrame'];
  vehicle: { current: RunnerVehicleClass };
  collisionState: RunnerPhysicsState['collisionState'];
  debugState: RunnerPhysicsState['debugState'];
  now: number;
  applyImpulseWithDebugTracking: (tag: string, impulse: Vec3Like) => void;
  rapier: Pick<RapierNamespace, 'Ray'>;
  world: RapierWorldQueries;
}) {
    // === DODGE STATE MACHINE (Goal 2) ===
    const ds = dodgeState.current;
    switch (ds.state) {
      case 'ready': {
        if (dodgeJustPressed && isGrounded) {
          ds.state = 'dodging';
          ds.timer = MOVEMENT.DODGE_DURATION;
          ds.nearMissAwarded = false;

          // Determine dodge direction from input
          const forwardDir = camera.getWorldDirection(_forwardDir);
          forwardDir.y = 0;
          forwardDir.normalize();
          const rightDir = _rightDir.crossVectors(forwardDir, camera.up).normalize();

          ds.direction.set(0, 0, 0);
          if (leftward) {
            ds.direction.sub(rightDir);
          } else if (rightward) {
            ds.direction.add(rightDir);
          } else if (backward) {
            ds.direction.sub(forwardDir);
          } else {
            ds.direction.add(forwardDir);
          }
          if (ds.direction.lengthSq() < 0.001) {
            ds.direction.copy(rightDir); // Default dodge right
          }
          ds.direction.normalize();

          // Apply dodge impulse
          applyImpulseWithDebugTracking('dodge', {
            x: ds.direction.x * MOVEMENT.DODGE_FORCE,
            y: 2.0, // Slight upward lift
            z: ds.direction.z * MOVEMENT.DODGE_FORCE
          });

          // I-frames: temporarily disable collision with obstacles (not ground)
          // We achieve this by applying a collision group mask if supported
          // Rapier has no simple collision-group toggle on a RigidBody ref, so
          // other systems read this flag. Set in place: the object also holds
          // the physics step's boot latches.
          bodyUserData(body).isDodging = true;

          playDodgeSound();
          triggerCameraShake(0.3, 0.15);

          useGameStore.getState().setIsDodging(true);
        }
        break;
      }

      case 'dodging': {
        const dodgeSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        if (!ds.nearMissAwarded && dodgeSpeed >= NEAR_MISS_SPEED_THRESHOLD) {
          const sideDir = _sideDir.set(-ds.direction.z, 0, ds.direction.x);
          if (sideDir.lengthSq() > 0.001) {
            sideDir.normalize();
            const checkSide = (sign: number) => {
              const ray = scratchRay(rapier, pos.x, pos.y + 0.6, pos.z, sideDir.x * sign, 0, sideDir.z * sign);
              const hit = world.castRay(ray, NEAR_MISS_RAY_LENGTH, true);
              const toi = getRayTimeOfImpact(hit);
              hit?.free?.();
              return toi !== null && toi >= NEAR_MISS_TOI_MIN && toi <= NEAR_MISS_TOI_MAX;
            };

            if (checkSide(1) || checkSide(-1)) {
              ds.nearMissAwarded = true;
              gameEvents.emit('player-near-miss', { speed: dodgeSpeed });
            }
          }
        }

        ds.timer -= dt;
        if (ds.timer <= 0) {
          ds.state = 'cooldown';
          ds.timer = MOVEMENT.DODGE_COOLDOWN;
          bodyUserData(body).isDodging = false;
          useGameStore.getState().setIsDodging(false);
        }
        break;
      }

      case 'cooldown': {
        ds.timer -= dt;
        if (ds.timer <= 0) {
          ds.state = 'ready';
        }
        break;
      }
    }

    // === COLLISION DETECTION ===
    // Check for sudden velocity changes indicating collision
    const prevVelocity = prevFrame.current.velocity;
    const velocityDelta = _velocityDelta.set(vel.x - prevVelocity.x, vel.y - prevVelocity.y, vel.z - prevVelocity.z);
    const impactForce = velocityDelta.length() / dt;

    // Detect high-impact collision (skip if dodging with i-frames)
    const isDodging = ds.state === 'dodging' && ds.timer > (MOVEMENT.DODGE_DURATION - MOVEMENT.DODGE_I_FRAMES);
    if (impactForce > 8 && !isGrounded && !isDodging) {
      if (hasActiveLaunch()) {
        recordLaunchWallContact();
      }
      const material = MATERIAL_FROM_BIOME[collisionState.current.currentBiome] || SurfaceMaterial.ROCK;
      const contactPoint = _contactPoint.set(pos.x, pos.y - 0.5, pos.z);

      vehicle.current.processCollision(
        material,
        impactForce,
        contactPoint,
        _relativeVelocity.set(vel.x, vel.y, vel.z),
      );

      // Add visual particles for high impact
      if (vehicle.current.isHighImpact(impactForce)) {
        emitCollisionBurst(collisionState.current.particles, material, contactPoint, Math.min(1, impactForce / 20));
        debugState.current.recentContacts.push({
          at: now,
          point: { x: contactPoint.x, y: contactPoint.y, z: contactPoint.z },
        });
      }
    }


}
