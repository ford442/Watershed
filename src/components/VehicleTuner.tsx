/**
 * VehicleTuner.tsx
 *
 * Applies real-time physics tuning to the player vehicle rigid body.
 * - Momentum & damping adjustments based on water proximity
 * - Controlled drifting (lateral slide + pivot torque)
 * - Wall friction / wall riding with raycast detection
 * - Boost mechanic with cooldown, audio, and visual event dispatch
 *
 * It reads no segment flow (#535 / #554 A): the segment sample it used to take was
 * guarded on a `SegmentData.active` field that does not exist, so it never ran — drift
 * always used the neutral flowSpeed 1, and the rapids lateral-retention and
 * flow auto-align branches were unreachable. Those were removed as dead code
 * (bit-identical); flow-dependent raft handling belongs in `GameplayProfile`.
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
import { gameEvents } from '../systems/events/GameEvents';
import type { VehicleRigidBodyRef } from '../experience/types';
import type { RapierRigidBody } from '@react-three/rapier';

const tmpPos = new THREE.Vector3();
const tmpVel = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpRayOrigin = new THREE.Vector3();
const tmpRayDir = new THREE.Vector3();
const tmpBoostDir = new THREE.Vector3();
/** Short-lived products (an impulse, an offset) read right after they are written (#521 F). */
const tmpScratch = new THREE.Vector3();

/**
 * The neutral segment flowSpeed drift scales with. The segment sample that would have
 * varied it never ran (see the header), so this is the value every run has used.
 */
const NEUTRAL_FLOW_SPEED = 1;

interface VehicleTunerProps {
  /** Ref to the vehicle RigidBody */
  targetRef: React.RefObject<VehicleRigidBodyRef | null>;
}

export default function VehicleTuner({ targetRef }: VehicleTunerProps) {
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
    // The mounted vehicle is a Rapier body; this reads the parts VehicleRigidBodyRef leaves out.
    const body = targetRef.current as RapierRigidBody;
    const pos = body.translation();
    const vel = body.linvel();
    tmpPos.set(pos.x, pos.y, pos.z);
    tmpVel.set(vel.x, vel.y, vel.z);

    // ========================================================================
    // 1. Momentum & Damping (water feel)
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
    // 2. Drifting (lateral slide + pivot torque)
    // ========================================================================
    const speed = Math.sqrt(tmpVel.x * tmpVel.x + tmpVel.z * tmpVel.z);
    const { leftward, rightward } = getKeys();
    const turning = leftward || rightward;

    if (inWater && speed > VEHICLE_TUNING.driftMinSpeed && turning) {
      const driftIntensity =
        VEHICLE_TUNING.driftFactor + NEUTRAL_FLOW_SPEED * VEHICLE_TUNING.driftFlowScale;

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

    }

    // ========================================================================
    // 3. Wall Friction / Wall Riding
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
    // 4. Boost Force
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
    // 5. Hard speed cap
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
