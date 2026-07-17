// src/hooks/useWaterFlowField.ts
// Boss Fight: Make the raft feel the visual current

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { useFrame } from '@react-three/fiber';

interface FlowFieldOptions {
  /** Multiplier for flow force strength */
  forceMultiplier?: number;
  /** Max force magnitude */
  maxForce?: number;
  /** Enable torque/rotation from flow */
  applyTorque?: boolean;
  /** Torque multiplier */
  torqueMultiplier?: number;
  /** Sample offset ahead of raft (for anticipation) */
  lookAheadDistance?: number;
}

interface FlowSample {
  direction: Vector3;
  speed: number;
}

/**
 * useWaterFlowField — Sync raft physics to water shader flow field
 * 
 * Usage in Raft.jsx:
 *   const shaderMatRef = useRef<THREE.ShaderMaterial>(null);
 *   const rigidBodyRef = useRef<RapierRigidBody>(null);
 *   
 *   useWaterFlowField(shaderMatRef, rigidBodyRef, {
 *     forceMultiplier: 5.5,
 *     maxForce: 60,
 *   });
 *   
 *   // In render:
 *   <FlowingWater ref={shaderMatRef} shaderId="water-test-v1" ... />
 */
export const useWaterFlowField = (
  shaderMaterialRef: React.MutableRefObject<THREE.ShaderMaterial | null>,
  raftRigidBodyRef: React.MutableRefObject<any>,
  options: FlowFieldOptions = {}
) => {
  const {
    forceMultiplier = 5.5,
    maxForce = 60,
    applyTorque = true,
    torqueMultiplier = 0.3,
    lookAheadDistance = 2.0,
  } = options;

  const flowVector = useRef(new Vector3());
  const torqueVector = useRef(new Vector3());
  const samplePos = useRef(new Vector3());

  const sampleFlowField = useCallback((position: Vector3, time: number): FlowSample => {
    const mat = shaderMaterialRef.current;
    if (!mat?.userData?.waterFlowField) {
      // Fallback if flow field not available
      return {
        direction: new Vector3(0, 0, -1),
        speed: 1.0,
      };
    }

    // Use the sampler exposed by FlowingWater
    return mat.userData.waterFlowField.sampleAt(position, time);
  }, []);

  useFrame((state) => {
    if (!shaderMaterialRef.current || !raftRigidBodyRef.current) return;

    const time = state.clock.elapsedTime;
    
    // Get raft position
    const raftPos = raftRigidBodyRef.current.translation();
    samplePos.current.set(raftPos.x, raftPos.y, raftPos.z);
    
    // Sample flow at raft position (or slightly ahead for anticipation)
    const samplePoint = samplePos.current.clone();
    samplePoint.z -= lookAheadDistance; // Look downstream
    
    const flowSample = sampleFlowField(samplePoint, time);
    
    // Calculate force vector
    flowVector.current.copy(flowSample.direction);
    flowVector.current.multiplyScalar(flowSample.speed * forceMultiplier);

    // Clamp max force
    if (flowVector.current.length() > maxForce) {
      flowVector.current.normalize().multiplyScalar(maxForce);
    }

    // Apply to Rapier rigid body
    raftRigidBodyRef.current.addForce(flowVector.current, true);

    // Optional: torque for drift/rotation feel
    if (applyTorque) {
      // Roll based on sideways flow component
      const sideForce = flowVector.current.x;
      torqueVector.current.set(0, 0, sideForce * torqueMultiplier);
      raftRigidBodyRef.current.addTorque(torqueVector.current, true);
      
      // Yaw rotation to align with flow
      const targetRotation = Math.atan2(flowSample.direction.x, -flowSample.direction.z);
      const currentRotation = raftRigidBodyRef.current.rotation?.y || 0;
      const rotationDiff = targetRotation - currentRotation;
      raftRigidBodyRef.current.addTorque(new Vector3(0, rotationDiff * 0.1, 0), true);
    }
  });

  return { sampleFlowField };
};

export default useWaterFlowField;
