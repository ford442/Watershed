/**
 * VehicleTuner.tsx
 *
 * Applies real-time physics tuning to the player vehicle rigid body.
 * - Momentum & damping adjustments based on water proximity
 * - Controlled drifting that scales with segment flowSpeed
 * - Wall friction / wall riding with raycast detection
 * - Boost mechanic with cooldown, audio, and visual event dispatch
 *
 * Designed to operate inside <Physics> with access to the Rapier world.
 */

import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { useRef, useEffect, useMemo } from 'react';
import { VEHICLE_TUNING } from '../constants/vehicleTuning';
import { getAudioManager, AudioManager } from '../systems/audio/AudioSystem';
import { WATER_LEVEL } from '../constants/game';
import { createSegmentFlowSample, sampleSegmentFlow, type SegmentFlowSample } from '../utils/segmentSampler';
import { gameEvents } from '../systems/events/GameEvents';

const tmpPos = new THREE.Vector3();
/** Two reusable samples (#502 D): the closest so far and the one being taken. */
let sampleBest = createSegmentFlowSample();
let sampleScratch = createSegmentFlowSample();
const tmpVel = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpRayOrigin = new THREE.Vector3();
const tmpRayDir = new THREE.Vector3();
const tmpBoostDir = new THREE.Vector3();
/** Short-lived products (an impulse, an offset) read right after they are written (#521 F). */
const tmpScratch = new THREE.Vector3();
const tmpFlatVel = new THREE.Vector3();
const tmpCross = new THREE.Vector3();

interface VehicleTunerProps {
  /** Ref to the vehicle RigidBody */
  targetRef: React.RefObject<any>;
  /** Active segments from TrackManager (to sample flowSpeed + type) */
  segments?: any[];
}

export default function VehicleTuner({ targetRef, segments = [] }: VehicleTunerProps) {
  const { world, rapier } = useRapier();
  // A Rapier Ray only holds its origin / dir objects; castRay reads them at call
  // time, so one Ray over the scratch vectors serves every wall probe.
  const wallRay = useMemo(() => new rapier.Ray(tmpRayOrigin, tmpRayDir), [rapier]);
  const [, getKeys] = useKeyboardControls();

  const boostState = useRef({
    active: 0,
    lastBoostTime: -9999,
  });

  const wallBoostState = useRef({
    cooldown: 0,
  });

  const dampingState = useRef({
    currentLinear: VEHICLE_TUNING.linearDampingAir,
    currentAngular: VEHICLE_TUNING.angularDampingAir,
  });

  const audioManager = useRef<AudioManager | null>(null);

  // Initialize audio reference lazily
  const getAudio = (): AudioManager | null => {
    if (!audioManager.current) {
      audioManager.current = getAudioManager();
    }
    return audioManager.current;
  };

  // Boost key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const now = performance.now() / 1000;
        if (now - boostState.current.lastBoostTime > VEHICLE_TUNING.boostCooldown) {
          boostState.current.active = VEHICLE_TUNING.boostDuration;
          boostState.current.lastBoostTime = now;

          // Audio feedback
          getAudio()?.playSound('boost', 0.9, 1.0);

          // Visual / shader feedback
          gameEvents.emit('boost-triggered', {
            intensity: VEHICLE_TUNING.boostVisualIntensity,
            duration: VEHICLE_TUNING.boostVisualDuration,
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useFrame((state, delta) => {
    if (!targetRef?.current || !world) return;
    const body = targetRef.current;
    const pos = body.translation();
    const vel = body.linvel();
    tmpPos.set(pos.x, pos.y, pos.z);
    tmpVel.set(vel.x, vel.y, vel.z);

    // ========================================================================
    // 1. Sample current segment for flow data
    // ========================================================================
    let closestSample: SegmentFlowSample | null = null;
    let closestDist = Infinity;

    for (const seg of segments) {
      if (!seg?.active || !seg.segmentPath) continue;
      const sample = sampleSegmentFlow(seg, tmpPos, sampleScratch);
      if (sample && sample.distance < closestDist) {
        closestDist = sample.distance;
        // Keep the winner; the next segment samples into the other buffer.
        [sampleBest, sampleScratch] = [sampleScratch, sampleBest];
        closestSample = sampleBest;
      }
    }

    const flowSpeed = closestSample?.flowSpeed ?? 1;
    const inRapids = flowSpeed > 1.3;

    // ========================================================================
    // 2. Momentum & Damping (water feel)
    // ========================================================================
    const inWater = pos.y < WATER_LEVEL + VEHICLE_TUNING.waterLevelThreshold;
    const targetLinear = inWater
      ? VEHICLE_TUNING.linearDampingWater
      : VEHICLE_TUNING.linearDampingAir;
    const targetAngular = inWater
      ? VEHICLE_TUNING.angularDampingWater
      : VEHICLE_TUNING.angularDampingAir;

    const lerpSpeed = VEHICLE_TUNING.dampingLerpSpeed * delta;
    dampingState.current.currentLinear += (targetLinear - dampingState.current.currentLinear) * lerpSpeed;
    dampingState.current.currentAngular += (targetAngular - dampingState.current.currentAngular) * lerpSpeed;

    let appliedLinearDamping = dampingState.current.currentLinear;
    let appliedAngularDamping = dampingState.current.currentAngular;

    // Reduce damping during boost for that "surge" feel
    if (boostState.current.active > 0) {
      boostState.current.active -= delta;
      appliedLinearDamping *= VEHICLE_TUNING.boostDampingMultiplier;
      appliedAngularDamping *= VEHICLE_TUNING.boostAngularDampingMultiplier;
    }

    body.setLinearDamping(appliedLinearDamping);
    body.setAngularDamping(appliedAngularDamping);

    // ========================================================================
    // 3. Drifting (lateral slide + pivot torque)
    // ========================================================================
    const speed = Math.sqrt(tmpVel.x * tmpVel.x + tmpVel.z * tmpVel.z);
    const { leftward, rightward } = getKeys();
    const turning = leftward || rightward;

    if (inWater && speed > VEHICLE_TUNING.driftMinSpeed && turning) {
      const driftIntensity =
        VEHICLE_TUNING.driftFactor + flowSpeed * VEHICLE_TUNING.driftFlowScale;

      const rot = body.rotation();
      tmpForward.set(0, 0, -1).applyQuaternion(rot).normalize();
      tmpRight.set(1, 0, 0).applyQuaternion(rot).normalize();

      const turnSign = leftward ? -1 : 1;

      // Lateral impulse in the turn direction (simulates reduced side friction)
      const lateralImpulse = tmpScratch
        .copy(tmpRight)
        .multiplyScalar(turnSign * speed * driftIntensity * 0.18 * delta);
      body.applyImpulse(
        { x: lateralImpulse.x, y: 0, z: lateralImpulse.z },
        true
      );

      // Pivot torque assist
      body.applyTorqueImpulse(
        {
          x: 0,
          y: turnSign * VEHICLE_TUNING.driftTorqueScale * delta * Math.min(speed, 12) * 0.25,
          z: 0,
        },
        true
      );

      // In rapids, exaggerate lateral velocity retention
      if (inRapids) {
        const lateralVel = tmpRight.dot(tmpVel);
        const retained = tmpScratch
          .copy(tmpRight)
          .multiplyScalar(lateralVel * (1 - VEHICLE_TUNING.driftLateralRetention) * delta * 2);
        body.applyImpulse(
          { x: retained.x, y: 0, z: retained.z },
          true
        );
      }
    }

    // ========================================================================
    // 4. Wall Friction / Wall Riding
    // ========================================================================
    const rot = body.rotation();
    tmpRight.set(1, 0, 0).applyQuaternion(rot).normalize();
    tmpForward.set(0, 0, -1).applyQuaternion(rot).normalize();

    let wallContact: { side: number; distance: number } | null = null;

    for (const side of [-1, 1] as const) {
      tmpRayOrigin.copy(tmpPos).setY(tmpPos.y + VEHICLE_TUNING.wallRayOriginYOffset);
      tmpRayDir.copy(tmpRight).multiplyScalar(side);
      const hit = world.castRay(wallRay, VEHICLE_TUNING.wallRayDistance, true);
      if (hit) {
        wallContact = { side, distance: hit.timeOfImpact };
        break;
      }
    }

    if (wallContact) {
      const proximity = 1 - wallContact.distance / VEHICLE_TUNING.wallRayDistance;
      const lateralVel = tmpRight.dot(tmpVel);
      const pressingTowardWall =
        (wallContact.side === -1 && leftward) || (wallContact.side === 1 && rightward);

      // Base wall friction opposing lateral slide
      let friction = VEHICLE_TUNING.wallFrictionBase;
      if (pressingTowardWall && speed > VEHICLE_TUNING.wallBoostMinSpeed) {
        friction *= VEHICLE_TUNING.wallFrictionBoost;
      }

      const frictionImpulse = -lateralVel * friction * proximity * delta * (body.mass?.() ?? 100);
      body.applyImpulse(
        {
          x: tmpRight.x * frictionImpulse,
          y: 0,
          z: tmpRight.z * frictionImpulse,
        },
        true
      );

      // Wall lift to keep raft from submarining into the wall
      if (inWater && proximity > 0.6) {
        body.applyImpulse(
          { x: 0, y: VEHICLE_TUNING.wallLiftForce * proximity * delta, z: 0 },
          true
        );
      }

      // Wall boost: pressing toward wall + moving fast = forward surge
      if (
        pressingTowardWall &&
        speed > VEHICLE_TUNING.wallBoostMinSpeed &&
        state.clock.elapsedTime > wallBoostState.current.cooldown
      ) {
        wallBoostState.current.cooldown =
          state.clock.elapsedTime + VEHICLE_TUNING.wallBoostCooldown;

        tmpBoostDir
          .copy(tmpForward)
          .add(tmpScratch.copy(tmpRight).multiplyScalar(wallContact.side * 0.25))
          .normalize();

        const boostImpulse = tmpBoostDir.multiplyScalar(
          VEHICLE_TUNING.wallBoostImpulse * delta
        );
        body.applyImpulse({ x: boostImpulse.x, y: 0, z: boostImpulse.z }, true);

        // Subtle audio feedback
        getAudio()?.playSound('raft_creak', 0.4, 1.05);
      }
    }

    // ========================================================================
    // 5. Boost Force
    // ========================================================================
    if (boostState.current.active > 0) {
      const boostDir =
        tmpForward.lengthSq() > 0.001
          ? tmpForward
          : tmpScratch.set(0, 0, -1);
      const boostImpulse = boostDir.multiplyScalar(
        VEHICLE_TUNING.boostStrength * delta
      );
      body.applyImpulse({ x: boostImpulse.x, y: 0, z: boostImpulse.z }, true);
    }

    // ========================================================================
    // 6. Auto-alignment to flow direction (optional, high speed only)
    // ========================================================================
    if (VEHICLE_TUNING.autoAlignToFlow && inWater && closestSample && speed > 8) {
      const flowDir = closestSample.tangent;
      const flatVel = tmpFlatVel.set(vel.x, 0, vel.z).normalize();
      const alignment = flatVel.dot(flowDir);
      if (alignment < 0.95) {
        const cross = tmpCross.crossVectors(flatVel, flowDir);
        const torqueY = cross.y * VEHICLE_TUNING.autoAlignTorque * delta * (speed / 10);
        body.applyTorqueImpulse({ x: 0, y: torqueY, z: 0 }, true);
      }
    }

    // ========================================================================
    // 7. Hard speed cap
    // ========================================================================
    const currentSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (currentSpeed > VEHICLE_TUNING.maxSpeedCap) {
      const scale = VEHICLE_TUNING.maxSpeedCap / currentSpeed;
      body.setLinvel(
        { x: vel.x * scale, y: vel.y * scale, z: vel.z * scale },
        true
      );
    }
  });

  return null;
}
