/**
 * vehicleTunerFrame.ts — VehicleTuner's per-frame body, for a headless run (#556 B.1).
 *
 * `components/VehicleTuner.tsx` is mounted by TrackManager for the runner too
 * (it is given `raftRef={vehicleRef}`), so on the page it shapes the runner's
 * motion every frame, after the SimCore step: water damping lerped toward
 * `linearDampingWater`, the wall-friction ray, the hard speed cap. It is a
 * component, outside SimCore, and off limits here (#554 A.2 owns its future) —
 * so a headless run carries this copy, and the campaign pin fails when it
 * drifts. What a copy leaves out is what no script or pilot reaches: keyboard
 * drift and wall boost need `getKeys()` (keyboard controls only — a script's
 * `moveX` is not a key), and the Space-bar boost, audio and `boost-triggered`
 * event need a key listener and `performance.now`.
 *
 * When VehicleTuner moves onto SimCore (#554 A.2), delete this file and register
 * that system in the headless run instead.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { WATER_LEVEL } from '../../constants/game';
import { VEHICLE_TUNING } from '../../constants/vehicleTuning';

const tmpPos = new THREE.Vector3();
const tmpVel = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpRayOrigin = new THREE.Vector3();
const tmpRayDir = new THREE.Vector3();

export interface HeadlessVehicleTuner {
  /** One frame: `delta` is R3F's frame delta. */
  frame(body: RAPIER.RigidBody, delta: number): void;
}

export function createHeadlessVehicleTuner(world: RAPIER.World, rapier: typeof RAPIER): HeadlessVehicleTuner {
  // A Rapier Ray only holds its origin / dir objects; castRay reads them at call time.
  const wallRay = new rapier.Ray(tmpRayOrigin, tmpRayDir);
  const damping = { linear: VEHICLE_TUNING.linearDampingAir, angular: VEHICLE_TUNING.angularDampingAir };

  return {
    frame(body, delta) {
      const pos = body.translation();
      const vel = body.linvel();
      tmpPos.set(pos.x, pos.y, pos.z);
      tmpVel.set(vel.x, vel.y, vel.z);

      // 1. Momentum & damping (water feel).
      const inWater = pos.y < WATER_LEVEL + VEHICLE_TUNING.waterLevelThreshold;
      const targetLinear = inWater ? VEHICLE_TUNING.linearDampingWater : VEHICLE_TUNING.linearDampingAir;
      const targetAngular = inWater ? VEHICLE_TUNING.angularDampingWater : VEHICLE_TUNING.angularDampingAir;
      const lerpSpeed = VEHICLE_TUNING.dampingLerpSpeed * delta;
      damping.linear += (targetLinear - damping.linear) * lerpSpeed;
      damping.angular += (targetAngular - damping.angular) * lerpSpeed;
      body.setLinearDamping(damping.linear);
      body.setAngularDamping(damping.angular);

      // 3. Wall friction (wall riding): no keys, so never "pressing toward the wall".
      const rot = body.rotation();
      tmpRight.set(1, 0, 0).applyQuaternion(rot).normalize();
      tmpForward.set(0, 0, -1).applyQuaternion(rot).normalize();

      let wallDistance: number | null = null;
      for (const side of [-1, 1] as const) {
        tmpRayOrigin.copy(tmpPos).setY(tmpPos.y + VEHICLE_TUNING.wallRayOriginYOffset);
        tmpRayDir.copy(tmpRight).multiplyScalar(side);
        const hit = world.castRay(wallRay, VEHICLE_TUNING.wallRayDistance, true);
        if (hit) {
          wallDistance = hit.timeOfImpact;
          break;
        }
      }
      if (wallDistance !== null) {
        const proximity = 1 - wallDistance / VEHICLE_TUNING.wallRayDistance;
        const lateralVel = tmpRight.dot(tmpVel);
        const frictionImpulse = -lateralVel * VEHICLE_TUNING.wallFrictionBase * proximity * delta * body.mass();
        body.applyImpulse({ x: tmpRight.x * frictionImpulse, y: 0, z: tmpRight.z * frictionImpulse }, true);
        // Wall lift to keep the body from submarining into the wall.
        if (inWater && proximity > 0.6) {
          body.applyImpulse({ x: 0, y: VEHICLE_TUNING.wallLiftForce * proximity * delta, z: 0 }, true);
        }
      }

      // 5. Hard speed cap.
      const currentSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (currentSpeed > VEHICLE_TUNING.maxSpeedCap) {
        const scale = VEHICLE_TUNING.maxSpeedCap / currentSpeed;
        body.setLinvel({ x: vel.x * scale, y: vel.y * scale, z: vel.z * scale }, true);
      }
    },
  };
}
