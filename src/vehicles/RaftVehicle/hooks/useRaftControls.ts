import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VEHICLE_TUNING } from '../../../constants/vehicleTuning';
import { useGameStore } from '../../../systems/GameState';
import {
  MATERIAL_FROM_BIOME,
  SurfaceMaterial,
  type RaftVehicle as RaftVehicleClass,
} from '../../../systems/vehicle/VehicleSystem';
import {
  SHED, COLLISION, BIAS,
  type BuoyancyState, type PaddleState, type StaminaState, type StunState, type TippingState,
} from '../constants';
import { playSplashSound } from '../audio';
import { triggerCameraShake } from '../../RunnerVehicle/utils';
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
import { createRaftPhysicsRuntime, type RaftImpulse } from './raftPhysicsRuntime';
import type { RaftCollisionState } from './useRaftPhysicsState';
import { recordUprightDistance } from '../../../systems/journey/runSession';
import type { PlayerControls } from '../../../hooks/usePlayerControls';
import type { RapierBody } from '../../../physics/rapierTypes';
import type { ParticlePool } from '../../../components/particlePool';
import { emitCollisionBurst } from '../../../components/CollisionParticles';

// Per-step scratch (#503 B).
const _quat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _velocityDelta = new THREE.Vector3();
const _contactPoint = new THREE.Vector3();
const _relativeVelocity = new THREE.Vector3();
const _bounce = new THREE.Vector3();

export interface UseRaftControlsParams {
  bodyRef: { current: RapierBody | null };
  raftVehicle: { current: RaftVehicleClass };
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

export function useRaftControls({
  bodyRef,
  raftVehicle,
  camera,
  controls,
  workerProxyRef,
  workerReadyRef,
  useWorkerPhysics,
  stepWorkerProxy,
  buoyancyState,
  tippingState,
  paddleState,
  staminaState,
  stunState,
  forwardBiasState,
  foamParticles,
  shedParticles,
  collisionState,
  raftMaterialRef,
  shelfLaunchFiredRef,
  shelfTriggerRef,
}: UseRaftControlsParams) {
  const raftBaseColor = useRef(new THREE.Color('saddlebrown'));
  const shedTimer = useRef(0);
  const timeRef = useRef(0);
  const currentFov = useRef(75);

  const runtimeRef = useRef<ReturnType<typeof createRaftPhysicsRuntime> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createRaftPhysicsRuntime({
      buoyancyState,
      tippingState,
      paddleState,
      staminaState,
      stunState,
      forwardBiasTimer: forwardBiasState,
      foamParticles,
      shedParticles,
      controls,
      camera,
      stepWorkerProxy,
      currentFov,
    });
  }

  useFrame((_state, delta) => {
    const runtime = runtimeRef.current;
    if (!runtime || !bodyRef.current) return;

    const body = bodyRef.current;
    const pos = body.translation();

    if (tippingState.current.isTipped) {
      runtime.resetRaft(body);
      return;
    }

    timeRef.current += delta;

    // Survival (wetness / core temp) ticks before stamina so this frame's paddle
    // economy already reflects it. No run session (free play, editor) → null, and
    // the modifiers stay at 1.
    const survivalMods = runtime.tickRaftSurvival(body, delta);
    runtime.paddleModifiers.cost = survivalMods?.paddleCostMultiplier ?? 1;
    runtime.paddleModifiers.regen = survivalMods?.paddleRegenMultiplier ?? 1;

    runtime.updateStamina(delta);

    if (stunState.current.active) {
      stunState.current.timer -= delta;
      if (stunState.current.timer <= 0) {
        stunState.current.active = false;
        stunState.current.timer = 0;
      }
    }

    // The Rapier worker owns the body once it is ready; until then the
    // main-thread body does, and WaterForceSystem applies its water force
    // (waterForceAuthority.ts — the raft never applies its own, #467).
    if (useWorkerPhysics && workerProxyRef.current && workerReadyRef.current) {
      runtime.updateWorkerPhysicsFrame(body, delta);
      return;
    }

    const submergedRatio = runtime.calculateSubmergedRatio(pos.y);
    buoyancyState.current.submergedRatio = submergedRatio;
    buoyancyState.current.isFloating = submergedRatio > 0.1;

    runtime.applyTurbulence(body, timeRef.current, delta);
    runtime.applyTippingForce(body, submergedRatio, delta);
    runtime.dampenRotation(body, delta);

    if (runtime.handleTipping(body, delta)) {
      runtime.resetRaft(body);
      return;
    }

    // Journey-results: upright distance while not in tip danger.
    if (tippingState.current.dangerTime <= 0) {
      const vel = body.linvel();
      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (speed > 0.05) {
        recordUprightDistance(speed * delta);
      }
    }

    runtime.applyPaddleForces(body, delta);

    if (forwardBiasState.current > 0) {
      forwardBiasState.current -= delta;
      if (!stunState.current.active) {
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

    const { leftward, rightward, backward, forward, paddleLeft, paddleRight } = controls.getControls();

    if (backward) {
      runtime.applyBrake(body, delta);
    }

    if (!paddleLeft && !paddleRight && !forward) {
      if (leftward || rightward) {
        raftVehicle.current.setInput({
          moveX: rightward ? 1 : leftward ? -1 : 0,
        });
        raftVehicle.current.update(delta);
      }
    }

    if (raftMaterialRef.current) {
      const vel = body.linvel();
      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      const wetnessLevel = submergedRatio * 0.6 + (speed > 4 ? Math.min(0.25, (speed - 4) * 0.03) : 0);
      const darken = 1.0 - wetnessLevel * 0.35;
      raftMaterialRef.current.color.copy(raftBaseColor.current).multiplyScalar(darken);
    }

    const { vel, speed } = runtime.updateCameraFromBody(body);

    try {
      const launch = tryFireShelfLaunch({
        currentSegmentIndex: useGameStore.getState().currentSegmentIndex,
        position: pos,
        velocity: vel,
        trigger: shelfTriggerRef.current,
        firedRef: shelfLaunchFiredRef,
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

    if (speed > SHED.MIN_SPEED && submergedRatio > SHED.MIN_SUBMERGED) {
      const speedRatio = Math.min(1, (speed - SHED.MIN_SPEED) / (SHED.SPEED_REF - SHED.MIN_SPEED));
      const emissionRate = SHED.EMISSION_RATE_BASE - speedRatio * (SHED.EMISSION_RATE_BASE - SHED.EMISSION_RATE_FAST);
      shedTimer.current += delta;
      if (shedTimer.current > emissionRate) {
        shedTimer.current = 0;
        runtime.spawnShedParticle(body);
      }
    }

    const prevVel = collisionState.current.prevVelocity;
    const velocityDelta = _velocityDelta.set(vel.x - prevVel.x, vel.y - prevVel.y, vel.z - prevVel.z);
    const impactForce = velocityDelta.length() / delta;

    if (impactForce > 6 && submergedRatio < 0.8) {
      const material = MATERIAL_FROM_BIOME[collisionState.current.currentBiome] || SurfaceMaterial.ROCK;
      const contactPoint = _contactPoint.set(pos.x, pos.y - 0.3, pos.z);

      raftVehicle.current.processCollision(
        material,
        impactForce,
        contactPoint,
        _relativeVelocity.set(vel.x, vel.y, vel.z),
      );

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
        stunState.current.active = true;
        stunState.current.timer = Math.min(scaledStun, COLLISION.STUN_MAX);
      }

      if (impactForce > 8) {
        runtime.spawnContactBurst(contactPoint, impactForce);
      }

      if (raftVehicle.current.isHighImpact(impactForce)) {
        emitCollisionBurst(collisionState.current.particles, material, contactPoint, forceFactor);
      }
    }

    collisionState.current.prevVelocity.set(vel.x, vel.y, vel.z);

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
        shelfTriggerRef.current &&
        !isInsideShelfTrigger(pos, shelfTriggerRef.current)
      ) {
        shelfLaunchFiredRef.current = false;
      }
    } catch (_e) {
      // Never let scoring break the raft frame.
    }
  });
}
