/**
 * Stage 3 — applyTerrainResponse (#559 C, from `RunnerPhysicsStep.ts`): slope
 * speed multiplier, bank assist, the waterfall gravity multiplier, the
 * segment-14 launch shelf.
 */
import * as THREE from 'three';
import { PHYSICS } from '../../../../constants/game';
import { VEHICLE_TUNING } from '../../../../constants/vehicleTuning';
import { gameEvents } from '../../../../systems/events/GameEvents';
import { tryFireShelfLaunch, getShelfDownstreamSpeed } from '../../../utils/shelfLaunch';
import { SMOOTHING_FACTOR, BANK_CONFIG } from '../../constants';
import { calculateSlopeMultiplier } from '../RunnerPhysicsHelpers';
import { isFiniteVec3 } from '../runnerAirControl';
import { bankT, type StepFrame } from './stepFrame';

/** Slope speed multiplier, bank assist, the waterfall gravity multiplier, the segment-14 launch shelf. */
export function applyTerrainResponse(f: StepFrame): void {
  const { args, s, dt, vel, pos, isGrounded } = f;
  const { body, world, vehicleState, shelfTriggerRef, shelfLaunchFiredRef } = args;
  const slope = vehicleState.slopeState.current;

  if (isGrounded) {
    slope.currentAngle = f.slopeAngle;
    // Base pitch multiplier, plus a bank bonus: steep canyon walls add flow / speed.
    let baseMult = calculateSlopeMultiplier(f.slopeAngle);
    const absBankDeg = Math.abs(slope.bankAngle);
    if (absBankDeg > BANK_CONFIG.ASSIST_THRESHOLD) {
      baseMult = Math.min(1.5, baseMult + bankT(absBankDeg) * BANK_CONFIG.BANK_SPEED_BONUS);
    }
    slope.targetMultiplier = baseMult;
  } else {
    slope.targetMultiplier = THREE.MathUtils.lerp(slope.targetMultiplier, 1.0, dt * 2.0);
  }
  slope.currentMultiplier = THREE.MathUtils.lerp(
    slope.currentMultiplier,
    slope.targetMultiplier,
    Math.min(1.0, dt * SMOOTHING_FACTOR),
  );

  // === BANK ASSIST (canyon U-wall riding) ===
  // On a steep lateral bank: a "plant" impulse into the bank face that grows
  // with speed (centripetal, keeps the player on the wall), and anti-roll
  // torque that damps capsule tumbling around world X and Z.
  const absBankDeg = Math.abs(slope.bankAngle);
  if (isGrounded && absBankDeg > BANK_CONFIG.ASSIST_THRESHOLD) {
    const t = bankT(absBankDeg);
    const gn = slope.lastGroundNormal;
    const speed2D = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const speedFactor = 1.0 + speed2D * BANK_CONFIG.SPEED_ASSIST_SCALE;
    const plantMag = BANK_CONFIG.ASSIST_STRENGTH * t * speedFactor * dt;
    // Push player into bank face (negate horizontal normal → toward wall surface)
    if (isFiniteVec3(gn)) {
      const im = s.impulse;
      im.x = -gn.x * plantMag;
      im.y = 0;
      im.z = -gn.z * plantMag;
      s.applyImpulse('bankAssist', im);
    }
    const angVel = body.angvel();
    const antiRoll = BANK_CONFIG.ANTI_ROLL_STRENGTH * t * dt;
    if (s.physicsWarm && isFiniteVec3(angVel)) {
      const torque = s.impulse;
      torque.x = -angVel.x * antiRoll;
      torque.y = 0;
      torque.z = -angVel.z * antiRoll;
      body.applyTorqueImpulse(torque, true);
    }
  }

  // === GRAVITY MULTIPLIER (waterfall / steep rapids) ===
  // The store's waterfallGravityMultiplier onto the Rapier world, read without
  // subscribing (no re-render) and written only on change, in place.
  f.gravMult = args.game.state().waterfallGravityMultiplier;
  if (f.gravMult !== vehicleState.appliedGravMultRef.current) {
    vehicleState.appliedGravMultRef.current = f.gravMult;
    world.gravity.x = 0;
    world.gravity.y = PHYSICS.GRAVITY * f.gravMult;
    world.gravity.z = 0;
  }

  // === WATERFALL LAUNCH-SHELF v2 (segment 14) ===
  // One-shot launch when crossing the authored slab shelf at speed.
  try {
    const sa = shelfArgs;
    sa.currentSegmentIndex = args.game.state().currentSegmentIndex;
    sa.position = pos;
    sa.velocity = vel;
    sa.trigger = shelfTriggerRef.current;
    sa.firedRef = shelfLaunchFiredRef;
    const launch = tryFireShelfLaunch(sa);
    if (launch) {
      s.applyImpulse('shelfLaunch', launch.impulse);
      gameEvents.emit('vehicle-shake', { vehicle: 'runner', intensity: 0.45, duration: 0.25 });
      gameEvents.emit('vehicle-jump', { speed: Math.sqrt(vel.x * vel.x + vel.z * vel.z), double: false });
      gameEvents.emit('shelfLaunch', {
        bodyHandle: body.handle,
        launchPos: pos,
        downstreamSpeed: getShelfDownstreamSpeed(vel),
      });
    }
  } catch (_e) {
    // Defensive: never let launch logic crash the physics step.
  }
}

// The helper's argument object, reused (#521 D): see RunnerPhysicsStep.ts.
const shelfArgs: Parameters<typeof tryFireShelfLaunch>[0] = {
  currentSegmentIndex: 0,
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  trigger: null,
  firedRef: { current: false },
  speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
  vehicleScale: VEHICLE_TUNING.shelfLaunch.runnerScale,
};
