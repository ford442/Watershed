// src/hooks/useVortexForce.ts
// Vortex physics — inward pull + rotational spin

import { useRef } from 'react';
import { Vector3 } from 'three';
import { useFrame } from '@react-three/fiber';

interface VortexOptions {
  /** Pull strength (arbitrary force units) */
  strength?: number;
  /** Rotation multiplier for torque */
  spinMultiplier?: number;
  /** Vortex radius in world units */
  radius?: number;
  /** Inner "eye" radius where pull weakens */
  eyeRadius?: number;
  /** Vertical lift force (suction upward) */
  liftForce?: number;
}

/**
 * useVortexForce — Applies whirlpool physics to a Rapier rigid body
 * 
 * Features:
 * - Inward pull that strengthens near the edge, weakens at center
 * - Rotational torque that spins the raft
 * - Optional vertical lift (suction)
 * - Smooth falloff using distance-based attenuation
 */
export const useVortexForce = (
  rigidBodyRef: React.MutableRefObject<any>,
  isInVortex: boolean,
  vortexCenter: Vector3,
  options: VortexOptions = {}
) => {
  const {
    strength = 48,
    spinMultiplier = 2.1,
    radius = 8,
    eyeRadius = 2,
    liftForce = 5,
  } = options;

  const pullVector = useRef(new Vector3());
  const tempPos = useRef(new Vector3());

  useFrame(() => {
    if (!isInVortex || !rigidBodyRef.current) return;

    const rbPos = rigidBodyRef.current.translation();
    tempPos.current.set(rbPos.x, rbPos.y, rbPos.z);

    // Vector from raft to vortex center
    pullVector.current.subVectors(vortexCenter, tempPos.current);
    const dist = pullVector.current.length();

    // Only apply force if within vortex radius
    if (dist > radius) return;

    // Normalize direction
    pullVector.current.normalize();

    // Pull strength: strongest at edge, weaker at center (eye)
    // Creates a "funnel" feel
    const distFactor = Math.max(0, (dist - eyeRadius) / (radius - eyeRadius));
    const pullMagnitude = strength * distFactor * distFactor; // Quadratic falloff

    // Apply inward pull
    const force = pullVector.current.clone().multiplyScalar(pullMagnitude);
    rigidBodyRef.current.addForce(force, true);

    // Rotational torque — perpendicular to pull direction
    // Creates the spinning "whirlpool" feel
    const spinAxis = new Vector3(0, 1, 0); // Y-axis rotation
    const tangent = new Vector3().crossVectors(pullVector.current, spinAxis).normalize();
    
    // Torque magnitude based on pull strength + spin multiplier
    const spinMagnitude = pullMagnitude * spinMultiplier;
    const torque = tangent.multiplyScalar(spinMagnitude);
    
    // Add some randomness to spin for organic feel
    torque.y += (Math.random() - 0.5) * spinMagnitude * 0.3;
    
    rigidBodyRef.current.addTorque(torque, true);

    // Optional lift force (suction) — pulls raft slightly upward near center
    if (dist < eyeRadius * 2 && liftForce > 0) {
      const lift = new Vector3(0, 1, 0).multiplyScalar(liftForce * (1 - dist / (eyeRadius * 2)));
      rigidBodyRef.current.addForce(lift, true);
    }
  });
};

export default useVortexForce;
