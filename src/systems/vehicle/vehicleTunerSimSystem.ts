/**
 * vehicleTunerSimSystem.ts — the vehicle tuner as a SimCore system (#577 A.2).
 *
 * `components/VehicleTuner.tsx` used to shape the mounted vehicle's motion from a
 * `useFrame` at priority 0, after SimCore, on R3F's frame delta, with its own
 * keyboard reads (`getKeys()`), a window `keydown` listener for the boost and
 * `performance.now` for the boost cooldown. A headless run carried a copy of its
 * frame (`sim/headless/vehicleTunerFrame.ts`) that left out everything a key drove.
 * It is now `vehicle-tuner` in SimCore's registry, so the page, a replay and a
 * headless run step the same code:
 *
 *   1. damping — linear / angular damping lerped toward the water or air values;
 *   2. drift — a lateral impulse and a yaw assist while turning in water at speed;
 *   3. wall riding — the side ray, wall friction, wall lift and the wall boost;
 *   4. boost — a forward impulse for `boostDuration` after a jump press;
 *   5. the hard speed cap.
 *
 * What changed with the move (one sim core, so every input device is the same
 * player): the turn is `ctx.input`'s strafe (a pad, touch, a script or a pilot
 * turns as the keyboard did), the boost is the JUMP button's rising edge (it was
 * the Space key's `keydown`), and both cooldowns run on `ctx.time` (sim seconds;
 * they ran on wall time and R3F's clock). The step's delta is `SIM_DT`. Sounds go
 * out as `vehicle-surge` cues; the host plays them (`hooks/useVehicleTunerSim`).
 *
 * Order 96: right after the vehicle's own step (95), so everything after the sim
 * step this frame (the camera follow, the lifecycle's speed, the water's force
 * sample) reads the shaped body, as it read VehicleTuner's.
 */
import * as THREE from 'three';
import type { SimSystem } from '../../sim/core/SimCore';
import { VEHICLE_TUNING } from '../../constants/vehicleTuning';
import { WATER_LEVEL } from '../../constants/game';
import { gameEvents } from '../events/GameEvents';
import { InputButton } from '../../input/InputFrame';
import type { RapierBody, RapierNamespace, RapierRay, RapierRayHit, RapierWorldQueries } from '../../physics/rapierTypes';

export const VEHICLE_TUNER_SIM_ORDER = 96;
export const VEHICLE_TUNER_SIM_ID = 'vehicle-tuner';

/** The strafe magnitude that counts as a held turn (`playerControls`' AXIS_PRESSED). */
const TURN_PRESSED = 0.5;

/**
 * The neutral segment flowSpeed drift scales with. VehicleTuner's segment sample
 * never ran (#535 / #554 A), so this is the value every run has used; flow-dependent
 * handling belongs in `GameplayProfile`.
 */
const NEUTRAL_FLOW_SPEED = 1;

/** The body calls the tuner makes beyond `RapierBody` (Rapier's `RigidBody` has both). */
export interface TunedBody extends RapierBody {
  setAngularDamping(damping: number): void;
  mass(): number;
}

export interface VehicleTunerBinding {
  world: RapierWorldQueries;
  rapier: Pick<RapierNamespace, 'Ray'>;
  /** The mounted vehicle's body, or null (the step is skipped). */
  getBody(): TunedBody | null;
}

/** What the tuner carries from step to step (exposed for tests). */
export interface VehicleTunerState {
  linearDamping: number;
  angularDamping: number;
  /** Seconds of boost force left. */
  boostLeft: number;
  /** `ctx.time` of the last boost. */
  lastBoostTime: number;
  /** `ctx.time` before which no wall boost fires. */
  wallBoostReadyAt: number;
  /** JUMP held on the last step (the boost fires on the press, not the hold). */
  jumpHeld: boolean;
}

function freshState(state: VehicleTunerState): VehicleTunerState {
  state.linearDamping = VEHICLE_TUNING.linearDampingAir;
  state.angularDamping = VEHICLE_TUNING.angularDampingAir;
  state.boostLeft = 0;
  state.lastBoostTime = Number.NEGATIVE_INFINITY;
  state.wallBoostReadyAt = 0;
  state.jumpHeld = false;
  return state;
}

const timeOfImpact = (hit: RapierRayHit): number =>
  typeof hit.timeOfImpact === 'function' ? hit.timeOfImpact() : (hit.timeOfImpact ?? 0);

export function createVehicleTunerSimSystem(binding: VehicleTunerBinding): SimSystem & { readonly state: VehicleTunerState } {
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  const boostDir = new THREE.Vector3();
  /** Short-lived products (an impulse, an offset) read right after they are written. */
  const scratch = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  // A Rapier Ray only holds its origin / dir objects; castRay reads them at call time.
  const wallRay: RapierRay = new binding.rapier.Ray(rayOrigin, rayDir);
  const impulse = { x: 0, y: 0, z: 0 };
  const state = freshState({} as VehicleTunerState);

  return {
    id: VEHICLE_TUNER_SIM_ID,
    order: VEHICLE_TUNER_SIM_ORDER,
    state,
    reset() {
      freshState(state);
    },
    step(ctx, dt) {
      const body = binding.getBody();
      const input = ctx.input;
      const jump = (input.buttons & InputButton.JUMP) !== 0;
      const pressed = jump && !state.jumpHeld;
      state.jumpHeld = jump;
      if (!body) return;

      // 4 (trigger). The boost: a jump press off cooldown.
      if (pressed && ctx.time - state.lastBoostTime > VEHICLE_TUNING.boostCooldown) {
        state.boostLeft = VEHICLE_TUNING.boostDuration;
        state.lastBoostTime = ctx.time;
        gameEvents.emit('vehicle-surge', { kind: 'boost' });
        gameEvents.emit('boost-triggered', {
          intensity: VEHICLE_TUNING.boostVisualIntensity,
          duration: VEHICLE_TUNING.boostVisualDuration,
        });
      }

      const p = body.translation();
      const v = body.linvel();
      pos.set(p.x, p.y, p.z);
      vel.set(v.x, v.y, v.z);
      const leftward = input.moveX < -TURN_PRESSED;
      const rightward = input.moveX > TURN_PRESSED;

      // 1. Momentum & damping (water feel).
      const inWater = pos.y < WATER_LEVEL + VEHICLE_TUNING.waterLevelThreshold;
      const targetLinear = inWater ? VEHICLE_TUNING.linearDampingWater : VEHICLE_TUNING.linearDampingAir;
      const targetAngular = inWater ? VEHICLE_TUNING.angularDampingWater : VEHICLE_TUNING.angularDampingAir;
      const lerpSpeed = VEHICLE_TUNING.dampingLerpSpeed * dt;
      state.linearDamping += (targetLinear - state.linearDamping) * lerpSpeed;
      state.angularDamping += (targetAngular - state.angularDamping) * lerpSpeed;
      let linearDamping = state.linearDamping;
      let angularDamping = state.angularDamping;
      // Less damping during a boost: the "surge".
      if (state.boostLeft > 0) {
        state.boostLeft -= dt;
        linearDamping *= VEHICLE_TUNING.boostDampingMultiplier;
        angularDamping *= VEHICLE_TUNING.boostAngularDampingMultiplier;
      }
      body.setLinearDamping(linearDamping);
      body.setAngularDamping(angularDamping);

      const r = body.rotation();
      quat.set(r.x, r.y, r.z, r.w);
      forward.set(0, 0, -1).applyQuaternion(quat).normalize();
      right.set(1, 0, 0).applyQuaternion(quat).normalize();

      // 2. Drift: lateral slide + pivot torque.
      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (inWater && speed > VEHICLE_TUNING.driftMinSpeed && (leftward || rightward)) {
        const driftIntensity = VEHICLE_TUNING.driftFactor + NEUTRAL_FLOW_SPEED * VEHICLE_TUNING.driftFlowScale;
        const turnSign = leftward ? -1 : 1;
        scratch.copy(right).multiplyScalar(turnSign * speed * driftIntensity * 0.18 * dt);
        impulse.x = scratch.x;
        impulse.y = 0;
        impulse.z = scratch.z;
        body.applyImpulse(impulse, true);
        impulse.x = 0;
        impulse.y = turnSign * VEHICLE_TUNING.driftTorqueScale * dt * Math.min(speed, 12) * 0.25;
        impulse.z = 0;
        body.applyTorqueImpulse(impulse, true);
      }

      // 3. Wall friction / wall riding.
      let wallSide = 0;
      let wallDistance = 0;
      for (let side = -1; side <= 1; side += 2) {
        rayOrigin.copy(pos).setY(pos.y + VEHICLE_TUNING.wallRayOriginYOffset);
        rayDir.copy(right).multiplyScalar(side);
        const hit = binding.world.castRay(wallRay, VEHICLE_TUNING.wallRayDistance, true);
        if (hit) {
          wallSide = side;
          wallDistance = timeOfImpact(hit);
          break;
        }
      }
      if (wallSide !== 0) {
        const proximity = 1 - wallDistance / VEHICLE_TUNING.wallRayDistance;
        const lateralVel = right.dot(vel);
        const pressingTowardWall = (wallSide === -1 && leftward) || (wallSide === 1 && rightward);
        let friction = VEHICLE_TUNING.wallFrictionBase;
        if (pressingTowardWall && speed > VEHICLE_TUNING.wallBoostMinSpeed) friction *= VEHICLE_TUNING.wallFrictionBoost;
        const frictionImpulse = -lateralVel * friction * proximity * dt * body.mass();
        impulse.x = right.x * frictionImpulse;
        impulse.y = 0;
        impulse.z = right.z * frictionImpulse;
        body.applyImpulse(impulse, true);

        // Wall lift: keep the hull from submarining into the wall.
        if (inWater && proximity > 0.6) {
          impulse.x = 0;
          impulse.y = VEHICLE_TUNING.wallLiftForce * proximity * dt;
          impulse.z = 0;
          body.applyImpulse(impulse, true);
        }

        // Wall boost: pressing toward the wall at speed is a forward surge.
        if (pressingTowardWall && speed > VEHICLE_TUNING.wallBoostMinSpeed && ctx.time > state.wallBoostReadyAt) {
          state.wallBoostReadyAt = ctx.time + VEHICLE_TUNING.wallBoostCooldown;
          boostDir.copy(forward).add(scratch.copy(right).multiplyScalar(wallSide * 0.25)).normalize();
          boostDir.multiplyScalar(VEHICLE_TUNING.wallBoostImpulse * dt);
          impulse.x = boostDir.x;
          impulse.y = 0;
          impulse.z = boostDir.z;
          body.applyImpulse(impulse, true);
          gameEvents.emit('vehicle-surge', { kind: 'wall' });
        }
      }

      // 4. The boost force.
      if (state.boostLeft > 0) {
        const dir = forward.lengthSq() > 0.001 ? forward : scratch.set(0, 0, -1);
        dir.multiplyScalar(VEHICLE_TUNING.boostStrength * dt);
        impulse.x = dir.x;
        impulse.y = 0;
        impulse.z = dir.z;
        body.applyImpulse(impulse, true);
      }

      // 5. Hard speed cap (on the velocity the step started from, as before).
      if (speed > VEHICLE_TUNING.maxSpeedCap) {
        const scale = VEHICLE_TUNING.maxSpeedCap / speed;
        impulse.x = v.x * scale;
        impulse.y = v.y * scale;
        impulse.z = v.z * scale;
        body.setLinvel(impulse, true);
      }
    },
  };
}
