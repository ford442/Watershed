import { useRunnerControls } from './RunnerVehicle/hooks/useRunnerControls';
import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { usePlayerControls } from '../hooks/usePlayerControls';
import * as THREE from 'three';
import { RunnerVehicle as RunnerVehicleClass, SurfaceMaterial, MATERIAL_FROM_BIOME } from '../systems/VehicleSystem';
import { CollisionParticles } from '../components/CollisionParticles';
import { WATER_LEVEL, PLAYER_SPAWN, MOVEMENT, PHYSICS } from '../constants/game';
import { VEHICLE_TUNING } from '../constants/vehicleTuning';
import { isFloatingPlatform } from '../systems/FloatingObjectRegistry';
import { useGameStore } from '../systems/GameState';

import {
    RAYCAST_ORIGIN_OFFSET, RAYCAST_DISTANCE, SMOOTHING_FACTOR, DEG_TO_RAD,
    JUMP_CONFIG, SLOPE_RANGES, BANK_CONFIG, NEAR_MISS_SPEED_THRESHOLD, NEAR_MISS_RAY_LENGTH, NEAR_MISS_TOI_MIN, NEAR_MISS_TOI_MAX, RUNNER_SPRINT, JumpState, DodgeState, DebugImpulse, DebugContact, PhysicsDebugSnapshot
} from './RunnerVehicle/constants';
import { initAudio, playJumpSound, playLandSound, playFootstep, playDodgeSound } from './RunnerVehicle/audio';
import { triggerCameraShake } from './RunnerVehicle/utils';
import { useRunnerPhysicsState } from './RunnerVehicle/hooks/useRunnerPhysics';

const RunnerVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef<any>(null);
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const controls = usePlayerControls(camera);


  
  const state = useRunnerPhysicsState();
  const {
    vehicle, slopeState, jumpState, ungroundedFramesRef, dodgeState, platformState,
    appliedGravMultRef, sprintLockedRef, jumpForwardDirRef, footstepState,
    prevFrame, collisionState, defaultCollisionGroups, fovRef, debugState, debugSnapshotRef
  } = state;

  useImperativeHandle(forwardedRef, () => bodyRef.current);

  useEffect(() => {
    if (bodyRef.current) {
      vehicle.current.initialize(bodyRef.current, new THREE.Vector3(...PLAYER_SPAWN.position));
      // Set initial material
      vehicle.current.setSurfaceMaterial(SurfaceMaterial.ROCK);
      // Store default collision groups for i-frame toggling
      defaultCollisionGroups.current = bodyRef.current.collisionGroups?.() ?? 0;
    }
    
    // Listen for biome changes
    const handleBiomeChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      const biome = customEvent.detail?.biome || 'summer';
      collisionState.current.currentBiome = biome;
      const material = MATERIAL_FROM_BIOME[biome] || SurfaceMaterial.ROCK;
      vehicle.current.setSurfaceMaterial(material);
      
      // Goal 2: Apply material friction to rigid body
      if (bodyRef.current) {
        const friction = vehicle.current.getConfig().friction;
        // We'll override friction dynamically in useFrame based on material
      }
    };
    
    window.addEventListener('biome-change', handleBiomeChange);
    return () => window.removeEventListener('biome-change', handleBiomeChange);
  }, []);

  const calculateSlopeAngle = (): number => {
    if (!bodyRef.current || !world) return 0;
    
    const pos = bodyRef.current.translation();
    
    // Primary path: use castRayAndGetNormal to obtain the true trimesh face normal.
    // This gives accurate per-triangle surface orientation on the canyon walls and U-banks,
    // which the height-gradient fallback cannot capture for near-vertical faces.
    // Note: castRayAndGetNormal exists in rapier3d-compat 0.19+ but @react-three/rapier's
    // TypeScript types may not declare it, hence the runtime presence check via `as any`.
    const centerOrigin = { x: pos.x, y: pos.y + RAYCAST_ORIGIN_OFFSET, z: pos.z };
    const centerNormalRay = new rapier.Ray(centerOrigin, { x: 0, y: -1, z: 0 });
    const normalHit = (world as any).castRayAndGetNormal
      ? (world as any).castRayAndGetNormal(centerNormalRay, RAYCAST_DISTANCE, true)
      : null;
    if (typeof (centerNormalRay as any).free === 'function') (centerNormalRay as any).free();

    if (normalHit) {
      const n = normalHit.normal ?? normalHit;
      const nLen = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
      if (nLen > 0.001) {
        slopeState.current.lastGroundNormal.set(n.x / nLen, n.y / nLen, n.z / nLen);
      }
      if (typeof (normalHit as any).free === 'function') (normalHit as any).free();

      const gn = slopeState.current.lastGroundNormal;
      // Bank angle: atan2(gn.x, gn.y) gives the lateral tilt of the surface normal.
      // Positive = normal leans toward +X (left wall tilts toward player from right side),
      // negative = normal leans toward -X.
      slopeState.current.bankAngle = (Math.atan2(gn.x, gn.y) * 180) / Math.PI;
      // Pitch angle: forward/back slope; keep existing sign convention (negative = downhill forward)
      const pitchAngleRad = Math.atan2(-gn.z, gn.y);
      let angleDeg = (pitchAngleRad * 180) / Math.PI;
      return Math.max(-60, Math.min(60, angleDeg));
    }

    // Fallback: five-point height-gradient sampling when castRayAndGetNormal unavailable
    const rayLength = RAYCAST_DISTANCE;
    const castRay = (offsetX: number, offsetZ: number): number | null => {
      const origin = {
        x: pos.x + offsetX,
        y: pos.y + RAYCAST_ORIGIN_OFFSET,
        z: pos.z + offsetZ
      };
      const ray = new rapier.Ray(origin, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, rayLength, true);
      const toi = hit ? (typeof (hit as any).timeOfImpact === 'function' ? (hit as any).timeOfImpact() : hit.timeOfImpact) : null;
      if (hit && typeof (hit as any).free === 'function') (hit as any).free();
      if (typeof (ray as any).free === 'function') (ray as any).free();
      if (toi === null) return null;
      return origin.y - toi;
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
  };

  const calculateSlopeMultiplier = (angle: number): number => {
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
  };


  useRunnerControls({
    bodyRef, camera, controls, vehicleState: state
  });

  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="dynamic"
        colliders={false}
        position={PLAYER_SPAWN.position}
        mass={75}
        friction={0.04}
        restitution={0.15}
        linearDamping={0.35}
        angularDamping={0.9}
      >
        <CapsuleCollider args={[0.4, 0.5]} />
      </RigidBody>
      
      {/* Collision particle effects */}
      {collisionState.current.activeParticles.map(particle => (
        <CollisionParticles
          key={particle.id}
          material={particle.material}
          position={particle.position}
          intensity={particle.intensity}
          onComplete={() => removeParticle(particle.id)}
        />
      ))}
    </>
  );
});

export default RunnerVehicle;
