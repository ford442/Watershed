import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VEHICLE_TUNING } from '../../../constants/vehicleTuning';
import { useGameStore } from '../../../systems/GameState';
import { applyRaftSteer, type CollisionTracker } from '../../../systems/vehicle/VehicleSystem';
import { getActiveGameplayProfile } from '../../../systems/gameplay/activeGameplayProfile';
import {
  SHED, COLLISION, BIAS,
  type BuoyancyState, type PaddleState, type StaminaState, type StunState, type TippingState,
} from '../constants';
import { playSplashSound } from '../audio';
import { triggerCameraShake } from '../../../hooks/useCameraShake';
import {
  tryFireShelfLaunch,
  getShelfDownstreamSpeed,
  isInsideShelfTrigger,
  type ShelfTrigger,
} from '../../utils/shelfLaunch';
import {
  tickLaunchScoring,
  hasActiveLaunch,
  recordLaunchWallContact,
} from '../../../systems/score/LaunchScoringSession';
import { gameEvents } from '../../../systems/events/GameEvents';
import type { RapierWorkerProxy } from '../../../physics/RapierWorkerProxy';
import { createRaftPhysicsRuntime, type RaftImpulse, type RaftPhysicsRuntime } from './raftPhysicsRuntime';
import type { RaftCollisionState } from './useRaftPhysicsState';
import { recordUprightDistance } from '../../../systems/journey/runSession';
import type { PlayerControls } from '../../../hooks/usePlayerControls';
import type { RapierBody, Vec3Like } from '../../../physics/rapierTypes';
import type { ParticlePool } from '../../../components/particlePool';
import { emitCollisionBurst } from '../../../components/CollisionParticles';

// Per-step scratch (#503 B).
const _quat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _velocityDelta = new THREE.Vector3();
const _contactPoint = new THREE.Vector3();
const _bounce = new THREE.Vector3();

export interface UseRaftControlsParams {
  bodyRef: { current: RapierBody | null };
  raftVehicle: CollisionTracker;
  camera: THREE.Camera;
  controls: { getControls: () => PlayerControls };
  workerProxyRef: { current: RapierWorkerProxy | null };
  workerReadyRef: { current: boolean };
  useWorkerPhysics: boolean;
  stepWorkerProxy: (body: RapierBody, delta: number, impulses?: RaftImpulse[]) => void;
  buoyancyState: { current: BuoyancyState };
  tippingState: { current: TippingState };
  paddleState: { current: PaddleState };
  staminaState: { current: StaminaState };
  stunState: { current: StunState };
  forwardBiasState: { current: number };
  foamParticles: ParticlePool;
  shedParticles: ParticlePool;
  collisionState: { current: RaftCollisionState };
  raftMaterialRef: { current: THREE.MeshStandardMaterial | null };
  shelfLaunchFiredRef: { current: boolean };
  shelfTriggerRef: { current: ShelfTrigger | null };
}


/*
 * The raft's frame, as named stages called in a fixed order (#521). The order
 * is the behaviour: impulses accumulate into Rapier in the order they are
 * applied, so a stage never moves. Every stage reads the hook's params object
 * (the latest render's, as the destructured closure did) and allocates nothing
 * of its own.
 */

/** Survival → paddle economy → stamina, then the stun countdown. */
function tickRaftEconomy(p: UseRaftControlsParams, runtime: RaftPhysicsRuntime, delta: number): void {
  // Survival (wetness / core temp) ticks before stamina so this frame's paddle
  // economy already reflects it. No run session (free play, editor) → null, and
  // the modifiers stay at 1.
  const survivalMods = runtime.tickRaftSurvival();
  runtime.paddleModifiers.cost = survivalMods?.paddleCostMultiplier ?? 1;
  runtime.paddleModifiers.regen = survivalMods?.paddleRegenMultiplier ?? 1;

  runtime.updateStamina(delta);

  const stunState = p.stunState;
  if (stunState.current.active) {
    stunState.current.timer -= delta;
    if (stunState.current.timer <= 0) {
      stunState.current.active = false;
      stunState.current.timer = 0;
    }
  }
}

/** Journey-results: upright distance while not in tip danger. */
function recordUprightTravel(p: UseRaftControlsParams, body: RapierBody, delta: number): void {
  if (p.tippingState.current.dangerTime <= 0) {
    const vel = body.linvel();
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (speed > 0.05) {
      recordUprightDistance(speed * delta);
    }
  }
}

/** The momentum a paddle stroke arms, decaying over BIAS.DURATION. */
function applyForwardBias(p: UseRaftControlsParams, body: RapierBody, delta: number): void {
  const forwardBiasState = p.forwardBiasState;
  if (forwardBiasState.current > 0) {
    forwardBiasState.current -= delta;
    if (!p.stunState.current.active) {
      const rot = body.rotation();
      const fwdDir = _forward.set(0, 0, -1).applyQuaternion(_quat.set(rot.x, rot.y, rot.z, rot.w));
      const biasFraction = forwardBiasState.current / BIAS.DURATION;
      body.applyImpulse({
        x: fwdDir.x * BIAS.FORCE * biasFraction * delta,
        y: 0,
        z: fwdDir.z * BIAS.FORCE * biasFraction * delta,
      }, true);
    }
  }
}

/** Brake (S), then the paddle-free steer (A / D). */
function applyRaftSteering(
  p: UseRaftControlsParams,
  runtime: RaftPhysicsRuntime,
  body: RapierBody,
  delta: number,
): void {
  const { leftward, rightward, backward, forward, paddleLeft, paddleRight } = p.controls.getControls();

  if (backward) {
    runtime.applyBrake(body, delta);
  }

  if (!paddleLeft && !paddleRight && !forward) {
    if (leftward || rightward) {
      applyRaftSteer(body, rightward ? 1 : leftward ? -1 : 0, delta);
    }
  }
}

/** Darken the hull with how wet it is (submersion + spray at speed). */
function tintWetHull(
  p: UseRaftControlsParams,
  body: RapierBody,
  submergedRatio: number,
  raftBaseColor: { current: THREE.Color },
): void {
  if (p.raftMaterialRef.current) {
    const vel = body.linvel();
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const wetnessLevel = submergedRatio * 0.6 + (speed > 4 ? Math.min(0.25, (speed - 4) * 0.03) : 0);
    const darken = 1.0 - wetnessLevel * 0.35;
    p.raftMaterialRef.current.color.copy(raftBaseColor.current).multiplyScalar(darken);
  }
}

/** Waterfall launch-shelf v2: the one-shot launch off the segment-14 shelf. */
function tryRaftShelfLaunch(
  p: UseRaftControlsParams,
  body: RapierBody,
  pos: Vec3Like,
  vel: Vec3Like,
  speed: number,
): void {
  try {
    const launch = tryFireShelfLaunch({
      currentSegmentIndex: useGameStore.getState().currentSegmentIndex,
      position: pos,
      velocity: vel,
      trigger: p.shelfTriggerRef.current,
      firedRef: p.shelfLaunchFiredRef,
      speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
      vehicleScale: VEHICLE_TUNING.shelfLaunch.raftScale,
    });
    if (launch) {
      body.applyImpulse(launch.impulse, true);
      triggerCameraShake(0.45, 0.25);
      playSplashSound(Math.min(1.5, speed));
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

/** Stern spray, emitted faster the faster the raft runs. */
function emitShedSpray(
  runtime: RaftPhysicsRuntime,
  body: RapierBody,
  speed: number,
  submergedRatio: number,
  shedTimer: { current: number },
  delta: number,
): void {
  if (speed > SHED.MIN_SPEED && submergedRatio > SHED.MIN_SUBMERGED) {
    const speedRatio = Math.min(1, (speed - SHED.MIN_SPEED) / (SHED.SPEED_REF - SHED.MIN_SPEED));
    const emissionRate = SHED.EMISSION_RATE_BASE - speedRatio * (SHED.EMISSION_RATE_BASE - SHED.EMISSION_RATE_FAST);
    shedTimer.current += delta;
    if (shedTimer.current > emissionRate) {
      shedTimer.current = 0;
      runtime.spawnShedParticle(body);
    }
  }
}

/** A sudden velocity change is an impact: bounce, spin, stun, spray, sparks. */
function detectRaftImpact(
  p: UseRaftControlsParams,
  runtime: RaftPhysicsRuntime,
  body: RapierBody,
  pos: Vec3Like,
  vel: Vec3Like,
  submergedRatio: number,
  delta: number,
): void {
  const prevVel = p.collisionState.current.prevVelocity;
  const velocityDelta = _velocityDelta.set(vel.x - prevVel.x, vel.y - prevVel.y, vel.z - prevVel.z);
  const impactForce = velocityDelta.length() / delta;

  if (impactForce > 6 && submergedRatio < 0.8) {
    const material = getActiveGameplayProfile().surface;
    const contactPoint = _contactPoint.set(pos.x, pos.y - 0.3, pos.z);

    p.raftVehicle.processCollision(material, impactForce, contactPoint);

    const forceFactor = Math.min(1, impactForce / COLLISION.IMPACT_FORCE_SCALE);
    const dxAbs = Math.abs(velocityDelta.x);
    const dzAbs = Math.abs(velocityDelta.z);
    const isLateralWallHit = dxAbs > dzAbs * COLLISION.WALL_LATERAL_RATIO;

    if (isLateralWallHit) {
      if (hasActiveLaunch() && submergedRatio < 0.35) {
        recordLaunchWallContact();
      }
      const bounceX = -velocityDelta.x * forceFactor * COLLISION.BOUNCE_FORCE * 0.08;
      const popY = Math.abs(velocityDelta.x) * forceFactor * COLLISION.BOUNCE_VERTICAL_DAMPING * 0.06;
      body.applyImpulse({ x: bounceX, y: popY, z: 0 }, true);
    } else {
      const bounceDir = _bounce.copy(velocityDelta).normalize().multiplyScalar(-forceFactor * COLLISION.BOUNCE_FORCE * 0.1);
      body.applyImpulse({
        x: bounceDir.x,
        y: Math.abs(bounceDir.y) * COLLISION.BOUNCE_VERTICAL_DAMPING + 0.5,
        z: bounceDir.z,
      }, true);
    }

    const spinDir = Math.sign(vel.x) || 1;
    const spinScale = isLateralWallHit ? 1.6 : 1.0;
    body.applyTorqueImpulse({
      x: 0,
      y: spinDir * COLLISION.SPIN_FORCE * Math.min(1, impactForce / COLLISION.SPIN_IMPACT_THRESHOLD) * spinScale,
      z: 0,
    }, true);

    if (impactForce > COLLISION.STUN_IMPACT_THRESHOLD) {
      const scaledStun = COLLISION.STUN_DURATION + forceFactor * (COLLISION.STUN_MAX - COLLISION.STUN_DURATION);
      p.stunState.current.active = true;
      p.stunState.current.timer = Math.min(scaledStun, COLLISION.STUN_MAX);
    }

    if (impactForce > 8) {
      runtime.spawnContactBurst(contactPoint, impactForce);
    }

    if (p.raftVehicle.isHighImpact(impactForce)) {
      emitCollisionBurst(p.collisionState.current.particles, material, contactPoint, forceFactor);
    }
  }
}

/** Launch scoring, and re-arming the shelf once the raft has left its trigger. */
function tickRaftLaunchScoring(
  p: UseRaftControlsParams,
  body: RapierBody,
  pos: Vec3Like,
  submergedRatio: number,
  delta: number,
): void {
  try {
    const physicsDt = delta;
    const raftContact = submergedRatio >= 0.35 ? 'water' : 'airborne';
    tickLaunchScoring({
      physicsDt,
      bodyHandle: body.handle,
      position: pos,
      contactSurface: raftContact,
      vehicle: 'raft',
    });

    if (
      !hasActiveLaunch() &&
      p.shelfTriggerRef.current &&
      !isInsideShelfTrigger(pos, p.shelfTriggerRef.current)
    ) {
      p.shelfLaunchFiredRef.current = false;
    }
  } catch (_e) {
    // Never let scoring break the raft frame.
  }
}

/** One raft frame: every stage above, in order. */
function stepRaftFrame(
  p: UseRaftControlsParams,
  runtime: RaftPhysicsRuntime,
  body: RapierBody,
  delta: number,
  timeRef: { current: number },
  shedTimer: { current: number },
  raftBaseColor: { current: THREE.Color },
): void {
  const pos = body.translation();

  if (p.tippingState.current.isTipped) {
    runtime.resetRaft(body);
    return;
  }

  timeRef.current += delta;
  p.raftVehicle.advanceClock(delta);

  tickRaftEconomy(p, runtime, delta);

  // Floating reads the staged surface the hull force reads (one datum), on
  // either physics path — survival's `inWater` comes from it.
  const submergedRatio = runtime.updateBuoyancy(pos.y);

  // The Rapier worker owns the body once it is ready; until then the
  // main-thread body does, and WaterForceSystem applies its water force
  // (waterForceAuthority.ts — the raft never applies its own, #467).
  if (p.useWorkerPhysics && p.workerProxyRef.current && p.workerReadyRef.current) {
    runtime.updateWorkerPhysicsFrame(body, delta);
    return;
  }

  runtime.applyTurbulence(body, timeRef.current, delta);
  runtime.applyTippingForce(body, submergedRatio, delta);
  runtime.dampenRotation(body, delta);

  if (runtime.handleTipping(body, delta)) {
    runtime.resetRaft(body);
    return;
  }

  recordUprightTravel(p, body, delta);
  runtime.applyPaddleForces(body, delta);
  applyForwardBias(p, body, delta);
  applyRaftSteering(p, runtime, body, delta);
  tintWetHull(p, body, submergedRatio, raftBaseColor);

  const { vel, speed } = runtime.updateCameraFromBody(body);

  tryRaftShelfLaunch(p, body, pos, vel, speed);
  emitShedSpray(runtime, body, speed, submergedRatio, shedTimer, delta);
  detectRaftImpact(p, runtime, body, pos, vel, submergedRatio, delta);
  p.collisionState.current.prevVelocity.set(vel.x, vel.y, vel.z);
  tickRaftLaunchScoring(p, body, pos, submergedRatio, delta);
}

export function useRaftControls(params: UseRaftControlsParams) {
  const raftBaseColor = useRef(new THREE.Color('saddlebrown'));
  const shedTimer = useRef(0);
  const timeRef = useRef(0);
  const currentFov = useRef(75);

  const runtimeRef = useRef<RaftPhysicsRuntime | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createRaftPhysicsRuntime({
      buoyancyState: params.buoyancyState,
      tippingState: params.tippingState,
      paddleState: params.paddleState,
      staminaState: params.staminaState,
      stunState: params.stunState,
      forwardBiasTimer: params.forwardBiasState,
      foamParticles: params.foamParticles,
      shedParticles: params.shedParticles,
      controls: params.controls,
      camera: params.camera,
      stepWorkerProxy: params.stepWorkerProxy,
      currentFov,
    });
  }

  useFrame((_state, delta) => {
    const runtime = runtimeRef.current;
    if (!runtime || !params.bodyRef.current) return;
    stepRaftFrame(params, runtime, params.bodyRef.current, delta, timeRef, shedTimer, raftBaseColor);
  });
}
