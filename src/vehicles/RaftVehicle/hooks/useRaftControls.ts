import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WATER_LEVEL } from '../../../constants/game';
import { VEHICLE_TUNING } from '../../../constants/vehicleTuning';
import { useGameStore } from '../../../systems/GameState';
import { MATERIAL_FROM_BIOME, SurfaceMaterial } from '../../../systems/VehicleSystem';
import { SHED, STAMINA, COLLISION, BIAS } from '../constants';
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
} from '../../../systems/LaunchScoringSession';
import { emitShelfLaunch } from '../../../systems/shelfLaunchEvents';
import type { RapierWorkerProxy } from '../../../physics/RapierWorkerProxy';
import { createRaftPhysicsRuntime } from './raftPhysicsRuntime';
import { isWaterForceSystemActive } from '../../../systems/WaterForceRegistry';

export interface UseRaftControlsParams {
  bodyRef: { current: any };
  raftVehicle: { current: any };
  camera: THREE.Camera;
  controls: { getControls: () => any };
  workerProxyRef: { current: RapierWorkerProxy | null };
  workerReadyRef: { current: boolean };
  useWorkerPhysics: boolean;
  applyWorkerImpulse: (impulse: THREE.Vector3) => void;
  stepWorkerProxy: (body: any, delta: number) => void;
  buoyancyState: { current: any };
  tippingState: { current: any };
  paddleState: { current: any };
  staminaState: { current: any };
  stunState: { current: any };
  forwardBiasState: { current: number };
  shedParticles: { current: any[] };
  collisionState: { current: any };
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
  applyWorkerImpulse,
  stepWorkerProxy,
  buoyancyState,
  tippingState,
  paddleState,
  staminaState,
  stunState,
  forwardBiasState,
  shedParticles,
  collisionState,
  raftMaterialRef,
  shelfLaunchFiredRef,
  shelfTriggerRef,
}: UseRaftControlsParams) {
  const raftBaseColor = useRef(new THREE.Color('saddlebrown'));
  const nextShedId = useRef(0);
  const shedTimer = useRef(0);
  const timeRef = useRef(0);
  const nextParticleId = useRef(0);
  const currentFov = useRef(75);
  const workerStepPendingRef = useRef(false);

  const runtimeRef = useRef<ReturnType<typeof createRaftPhysicsRuntime> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createRaftPhysicsRuntime({
      buoyancyState,
      tippingState,
      paddleState,
      staminaState,
      stunState,
      forwardBiasTimer: forwardBiasState,
      raftMaterialRef,
      raftBaseColor,
      shedParticles,
      nextShedId,
      shedTimer,
      timeRef,
      nextParticleId,
      collisionState,
      raftVehicle,
      controls,
      camera,
      workerProxyRef,
      workerReadyRef,
      workerStepPendingRef,
      useWorkerPhysics,
      applyWorkerImpulse,
      stepWorkerProxy,
      currentFov,
      shelfLaunchFiredRef,
      shelfTriggerRef,
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
    runtime.updateStamina(delta);

    if (stunState.current.active) {
      stunState.current.timer -= delta;
      if (stunState.current.timer <= 0) {
        stunState.current.active = false;
        stunState.current.timer = 0;
      }
    }

    if (useWorkerPhysics && workerProxyRef.current && workerReadyRef.current) {
      runtime.updateWorkerPhysicsFrame(body, delta);
      return;
    }

    const submergedRatio = runtime.calculateSubmergedRatio(pos.y);
    buoyancyState.current.submergedRatio = submergedRatio;

    const wasmForcesActive = isWaterForceSystemActive();
    if (!wasmForcesActive) {
      runtime.applyBuoyancy(body, submergedRatio, delta);
      if (submergedRatio > 0) {
        runtime.applyDrag(body, delta);
      }
      if (submergedRatio > 0.1) {
        runtime.applyFlowForce(body, delta);
      }
    }

    runtime.applyTurbulence(body, timeRef.current, delta);
    runtime.applyTippingForce(body, submergedRatio, delta);
    runtime.dampenRotation(body, delta);

    if (runtime.handleTipping(body, delta)) {
      runtime.resetRaft(body);
      return;
    }

    runtime.applyPaddleForces(body, delta);

    if (forwardBiasState.current > 0) {
      forwardBiasState.current -= delta;
      if (!stunState.current.active) {
        const rot = body.rotation();
        const fwdDir = new THREE.Vector3(0, 0, -1).applyQuaternion(rot);
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
        emitShelfLaunch({
          bodyHandle: body.handle,
          launchPos: pos,
          downstreamSpeed: getShelfDownstreamSpeed(vel),
        });
      }
    } catch (_e) {
      // Defensive: never let launch logic crash the physics step.
    }

    paddleState.current.foamParticles = paddleState.current.foamParticles
      .map((p: any) => ({
        ...p,
        position: p.position.clone().add(p.velocity.clone().multiplyScalar(delta)),
        life: p.life - delta,
      }))
      .filter((p: any) => p.life > 0);

    if (speed > SHED.MIN_SPEED && submergedRatio > SHED.MIN_SUBMERGED) {
      const speedRatio = Math.min(1, (speed - SHED.MIN_SPEED) / (SHED.SPEED_REF - SHED.MIN_SPEED));
      const emissionRate = SHED.EMISSION_RATE_BASE - speedRatio * (SHED.EMISSION_RATE_BASE - SHED.EMISSION_RATE_FAST);
      shedTimer.current += delta;
      if (shedTimer.current > emissionRate) {
        shedTimer.current = 0;
        runtime.spawnShedParticle(body);
      }
    }

    shedParticles.current = shedParticles.current
      .map((p: any) => ({
        ...p,
        position: p.position.clone().add(p.velocity.clone().multiplyScalar(delta)),
        velocity: p.velocity.clone().add(new THREE.Vector3(0, -1.5 * delta, 0)),
        life: p.life - delta,
      }))
      .filter((p: any) => p.life > 0);

    const prevVel = collisionState.current.prevVelocity;
    const velocityDelta = new THREE.Vector3(vel.x - prevVel.x, vel.y - prevVel.y, vel.z - prevVel.z);
    const impactForce = velocityDelta.length() / delta;

    if (impactForce > 6 && submergedRatio < 0.8) {
      const material = MATERIAL_FROM_BIOME[collisionState.current.currentBiome] || SurfaceMaterial.ROCK;
      const contactPoint = new THREE.Vector3(pos.x, pos.y - 0.3, pos.z);

      raftVehicle.current.processCollision(
        material,
        impactForce,
        contactPoint,
        new THREE.Vector3(vel.x, vel.y, vel.z),
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
        const bounceDir = velocityDelta.clone().normalize().multiplyScalar(-forceFactor * COLLISION.BOUNCE_FORCE * 0.1);
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

        window.dispatchEvent(new CustomEvent('raft-wall-impact', {
          detail: { force: impactForce, isWall: isLateralWallHit },
        }));
      }

      if (impactForce > 8) {
        runtime.spawnContactBurst(body, contactPoint, impactForce);
      }

      if (impactForce > raftVehicle.current.highImpactThreshold) {
        collisionState.current.activeParticles.push({
          id: Date.now(),
          material,
          position: contactPoint.clone(),
          intensity: forceFactor,
        });
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

    window.dispatchEvent(new CustomEvent('raft-stamina', {
      detail: {
        current: staminaState.current.current,
        max: STAMINA.MAX,
        isExhausted: staminaState.current.isExhausted,
      },
    }));
  });
}
