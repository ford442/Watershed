/**
 * RaftPhysicsStep.ts — one raft physics step (#577 A.1).
 *
 * This was `useRaftControls`' `useFrame` body: it ran on R3F's frame delta
 * (scaled by the game-speed assist) after SimCore, read `useGameStore`, and
 * moved the camera and tinted the hull in the middle of the physics. It is
 * SimCore's `vehicle-raft` step now (raftSimSystem.ts): `SIM_DT`, `ctx.input`
 * through `PlayerControls`, `ctx.game` for the run state. The camera follow and
 * the wet-hull tint are the host's, once per frame (raftCameraSync.ts,
 * useRaftControls.ts).
 *
 * The stages run in a fixed order. The order is the behaviour: impulses
 * accumulate into Rapier in the order they are applied, so a stage never moves.
 * Nothing here allocates per step.
 */
import * as THREE from 'three';
import { VEHICLE_TUNING } from '../../../constants/vehicleTuning';
import { applyRaftSteer, type CollisionTracker } from '../../../systems/vehicle/VehicleSystem';
import { getActiveGameplayProfile } from '../../../systems/gameplay/activeGameplayProfile';
import { SHED, COLLISION, BIAS } from '../constants';
import {
  tryFireShelfLaunch,
  getShelfDownstreamSpeed,
  isInsideShelfTrigger,
  type ShelfTrigger,
} from '../../utils/shelfLaunch';
import { tickLaunchScoring, hasActiveLaunch, recordLaunchWallContact } from '../../../systems/score/LaunchScoringSession';
import { gameEvents } from '../../../systems/events/GameEvents';
import { recordUprightDistance } from '../../../systems/journey/runSession';
import type { PlayerControls } from '../../../input/playerControls';
import type { RapierBody, Vec3Like } from '../../../physics/rapierTypes';
import type { SimGamePort } from '../../../sim/core/simGame';
import type { RaftPhysicsRuntime } from './raftPhysicsRuntime';
import type { RaftPhysicsState } from '../raftPhysicsState';

// Per-step scratch (#503 B).
const _quat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _velocityDelta = new THREE.Vector3();
const _contactPoint = new THREE.Vector3();
const _bounce = new THREE.Vector3();
const _impulse = { x: 0, y: 0, z: 0 };

/** One step's inputs. One object, rewritten per step by the system (#521 D). */
export interface RaftStepArgs {
  delta: number;
  game: SimGamePort;
  body: RapierBody;
  /** This step's controls (`fillPlayerControls(ctx.input)`). */
  controls: PlayerControls;
  state: RaftPhysicsState;
  runtime: RaftPhysicsRuntime;
  /** Impact events on the raft's own sim clock. */
  collisions: CollisionTracker;
  shelfLaunchFiredRef: { current: boolean };
  shelfTriggerRef: { current: ShelfTrigger | null };
  /** The Rapier worker owns the body this step (it is ready): post impulses, apply none. */
  workerOwnsBody: boolean;
}

/** Survival → paddle economy → stamina, then the stun countdown. */
function tickRaftEconomy(a: RaftStepArgs): void {
  // Survival (wetness / core temp) ticks before stamina so this step's paddle
  // economy already reflects it. No run session (free play, editor) → null, and
  // the modifiers stay at 1.
  const survivalMods = a.runtime.tickRaftSurvival();
  a.runtime.paddleModifiers.cost = survivalMods?.paddleCostMultiplier ?? 1;
  a.runtime.paddleModifiers.regen = survivalMods?.paddleRegenMultiplier ?? 1;

  a.runtime.updateStamina(a.delta);

  const stun = a.state.stunState.current;
  if (stun.active) {
    stun.timer -= a.delta;
    if (stun.timer <= 0) {
      stun.active = false;
      stun.timer = 0;
    }
  }
}

/** Journey results: upright distance while not in tip danger. */
function recordUprightTravel(a: RaftStepArgs): void {
  if (a.state.tippingState.current.dangerTime <= 0) {
    const vel = a.body.linvel();
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (speed > 0.05) recordUprightDistance(speed * a.delta);
  }
}

/** The momentum a paddle stroke arms, decaying over BIAS.DURATION. */
function applyForwardBias(a: RaftStepArgs): void {
  const bias = a.state.forwardBiasState;
  if (bias.current > 0) {
    bias.current -= a.delta;
    if (!a.state.stunState.current.active) {
      const rot = a.body.rotation();
      const fwd = _forward.set(0, 0, -1).applyQuaternion(_quat.set(rot.x, rot.y, rot.z, rot.w));
      const biasFraction = bias.current / BIAS.DURATION;
      _impulse.x = fwd.x * BIAS.FORCE * biasFraction * a.delta;
      _impulse.y = 0;
      _impulse.z = fwd.z * BIAS.FORCE * biasFraction * a.delta;
      a.body.applyImpulse(_impulse, true);
    }
  }
}

/** Brake (S), then the paddle-free steer (A / D). */
function applyRaftSteering(a: RaftStepArgs): void {
  const { leftward, rightward, backward, forward, paddleLeft, paddleRight } = a.controls;
  if (backward) a.runtime.applyBrake(a.body, a.delta);
  if (!paddleLeft && !paddleRight && !forward && (leftward || rightward)) {
    applyRaftSteer(a.body, rightward ? 1 : -1, a.delta);
  }
}

/** Waterfall launch-shelf v2: the one-shot launch off the segment-14 shelf. */
function tryRaftShelfLaunch(a: RaftStepArgs, pos: Vec3Like, vel: Vec3Like, speed: number): void {
  try {
    const launch = tryFireShelfLaunch({
      currentSegmentIndex: a.game.state().currentSegmentIndex,
      position: pos,
      velocity: vel,
      trigger: a.shelfTriggerRef.current,
      firedRef: a.shelfLaunchFiredRef,
      speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
      vehicleScale: VEHICLE_TUNING.shelfLaunch.raftScale,
    });
    if (launch) {
      a.body.applyImpulse(launch.impulse, true);
      gameEvents.emit('vehicle-shake', { vehicle: 'raft', intensity: 0.45, duration: 0.25 });
      gameEvents.emit('raft-splash', { intensity: Math.min(1.5, speed) });
      gameEvents.emit('shelfLaunch', {
        bodyHandle: a.body.handle,
        launchPos: pos,
        downstreamSpeed: getShelfDownstreamSpeed(vel),
      });
    }
  } catch (_e) {
    // Defensive: never let launch logic crash the physics step.
  }
}

/** Stern spray, emitted faster the faster the raft runs. */
function emitShedSpray(a: RaftStepArgs, speed: number, submergedRatio: number): void {
  if (speed > SHED.MIN_SPEED && submergedRatio > SHED.MIN_SUBMERGED) {
    const speedRatio = Math.min(1, (speed - SHED.MIN_SPEED) / (SHED.SPEED_REF - SHED.MIN_SPEED));
    const emissionRate = SHED.EMISSION_RATE_BASE - speedRatio * (SHED.EMISSION_RATE_BASE - SHED.EMISSION_RATE_FAST);
    a.state.shedTimer += a.delta;
    if (a.state.shedTimer > emissionRate) {
      a.state.shedTimer = 0;
      a.runtime.spawnShedParticle(a.body);
    }
  }
}

/** A sudden velocity change is an impact: bounce, spin, stun, spray, sparks. */
function detectRaftImpact(a: RaftStepArgs, pos: Vec3Like, vel: Vec3Like, submergedRatio: number): void {
  const { body, delta } = a;
  const prevVel = a.state.prevVelocity;
  const velocityDelta = _velocityDelta.set(vel.x - prevVel.x, vel.y - prevVel.y, vel.z - prevVel.z);
  const impactForce = velocityDelta.length() / delta;
  if (!(impactForce > 6 && submergedRatio < 0.8)) return;

  const material = getActiveGameplayProfile().surface;
  const contactPoint = _contactPoint.set(pos.x, pos.y - 0.3, pos.z);
  a.collisions.processCollision(material, impactForce, contactPoint);

  const forceFactor = Math.min(1, impactForce / COLLISION.IMPACT_FORCE_SCALE);
  const dxAbs = Math.abs(velocityDelta.x);
  const dzAbs = Math.abs(velocityDelta.z);
  const isLateralWallHit = dxAbs > dzAbs * COLLISION.WALL_LATERAL_RATIO;

  if (isLateralWallHit) {
    if (hasActiveLaunch() && submergedRatio < 0.35) recordLaunchWallContact();
    _impulse.x = -velocityDelta.x * forceFactor * COLLISION.BOUNCE_FORCE * 0.08;
    _impulse.y = Math.abs(velocityDelta.x) * forceFactor * COLLISION.BOUNCE_VERTICAL_DAMPING * 0.06;
    _impulse.z = 0;
    body.applyImpulse(_impulse, true);
  } else {
    const bounceDir = _bounce.copy(velocityDelta).normalize().multiplyScalar(-forceFactor * COLLISION.BOUNCE_FORCE * 0.1);
    _impulse.x = bounceDir.x;
    _impulse.y = Math.abs(bounceDir.y) * COLLISION.BOUNCE_VERTICAL_DAMPING + 0.5;
    _impulse.z = bounceDir.z;
    body.applyImpulse(_impulse, true);
  }

  const spinDir = Math.sign(vel.x) || 1;
  const spinScale = isLateralWallHit ? 1.6 : 1.0;
  _impulse.x = 0;
  _impulse.y = spinDir * COLLISION.SPIN_FORCE * Math.min(1, impactForce / COLLISION.SPIN_IMPACT_THRESHOLD) * spinScale;
  _impulse.z = 0;
  body.applyTorqueImpulse(_impulse, true);

  if (impactForce > COLLISION.STUN_IMPACT_THRESHOLD) {
    const scaledStun = COLLISION.STUN_DURATION + forceFactor * (COLLISION.STUN_MAX - COLLISION.STUN_DURATION);
    a.state.stunState.current.active = true;
    a.state.stunState.current.timer = Math.min(scaledStun, COLLISION.STUN_MAX);
  }

  if (impactForce > 8) a.runtime.spawnContactBurst(contactPoint, impactForce);

  if (a.collisions.isHighImpact(impactForce)) {
    gameEvents.emit('vehicle-impact', { vehicle: 'raft', material, point: contactPoint, intensity: forceFactor });
  }
}

/** Launch scoring, and re-arming the shelf once the raft has left its trigger. */
function tickRaftLaunchScoring(a: RaftStepArgs, pos: Vec3Like, submergedRatio: number): void {
  try {
    tickLaunchScoring({
      physicsDt: a.delta,
      bodyHandle: a.body.handle,
      position: pos,
      contactSurface: submergedRatio >= 0.35 ? 'water' : 'airborne',
      vehicle: 'raft',
    });
    const trigger = a.shelfTriggerRef.current;
    if (!hasActiveLaunch() && trigger && !isInsideShelfTrigger(pos, trigger)) {
      a.shelfLaunchFiredRef.current = false;
    }
  } catch (_e) {
    // Never let scoring break the raft step.
  }
}

/** One raft step: every stage above, in order. */
export function stepRaft(a: RaftStepArgs): void {
  const { body, runtime, state, delta } = a;
  const pos = body.translation();

  if (state.tippingState.current.isTipped) {
    runtime.resetRaft(body);
    return;
  }

  state.time += delta;
  a.collisions.advanceClock(delta);

  tickRaftEconomy(a);

  // Floating reads the staged surface the hull force reads (one datum), on
  // either physics path — survival's `inWater` comes from it.
  const submergedRatio = runtime.updateBuoyancy(pos.y);

  // The Rapier worker owns the body once it is ready; until then the
  // main-thread body does, and WaterForceSystem applies its water force
  // (waterForceAuthority.ts — the raft never applies its own, #467).
  if (a.workerOwnsBody) {
    runtime.updateWorkerPhysicsFrame(body, delta);
    return;
  }

  runtime.applyTurbulence(body, state.time, delta);
  runtime.applyTippingForce(body, submergedRatio, delta);
  runtime.dampenRotation(body, delta);

  if (runtime.handleTipping(body, delta)) {
    runtime.resetRaft(body);
    return;
  }

  recordUprightTravel(a);
  runtime.applyPaddleForces(body, delta);
  applyForwardBias(a);
  applyRaftSteering(a);

  const vel = body.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  tryRaftShelfLaunch(a, pos, vel, speed);
  emitShedSpray(a, speed, submergedRatio);
  detectRaftImpact(a, pos, vel, submergedRatio);
  state.prevVelocity.set(vel.x, vel.y, vel.z);
  tickRaftLaunchScoring(a, pos, submergedRatio);
}
