// src/hooks/useVortexForce.ts
// Vortex physics — inward pull + rotational spin + downward drain suction

import { useRef } from 'react';
import { Vector3 } from 'three';
import { useFrame } from '@react-three/fiber';
import {
  computeVortexForces,
  resolveVortexConfig,
  type VortexForceConfig,
} from '../physics/vortexForces';

interface VortexOptions extends Partial<VortexForceConfig> {
  /** @deprecated Prefer downwardForce — kept for older call sites. */
  liftForce?: number;
  /** Extra multiplier (forecast gate strength, etc.). */
  strengthMult?: number;
}

/**
 * useVortexForce — Applies whirlpool physics to a Rapier rigid body.
 *
 * Uses the pure `computeVortexForces` helper so unit tests cover the funnel
 * model without mounting R3F / Rapier.
 */
export const useVortexForce = (
  rigidBodyRef: React.MutableRefObject<any>,
  isInVortex: boolean,
  vortexCenter: Vector3,
  options: VortexOptions = {},
) => {
  const {
    liftForce,
    strengthMult = 1,
    ...forcePartial
  } = options;

  // Legacy liftForce mapped to a mild upward bias; Hydro-Dam prefers downward.
  const config = resolveVortexConfig({
    ...forcePartial,
    downwardForce:
      forcePartial.downwardForce ??
      (typeof liftForce === 'number' ? -liftForce : undefined),
  });

  const lastForce = useRef({ x: 0, y: 0, z: 0 });

  useFrame((_, delta) => {
    if (!isInVortex || !rigidBodyRef.current) return;

    const rbPos = rigidBodyRef.current.translation();
    const result = computeVortexForces(
      { x: rbPos.x, y: rbPos.y, z: rbPos.z },
      { x: vortexCenter.x, y: vortexCenter.y, z: vortexCenter.z },
      config,
      strengthMult,
    );
    if (!result.inside) return;

    const dtScale = Math.min(delta, 0.05) * 60;
    lastForce.current = result.force;

    if (typeof rigidBodyRef.current.applyImpulse === 'function') {
      rigidBodyRef.current.applyImpulse(
        {
          x: result.force.x * dtScale * 0.016,
          y: result.force.y * dtScale * 0.016,
          z: result.force.z * dtScale * 0.016,
        },
        true,
      );
    } else {
      rigidBodyRef.current.addForce?.(result.force, true);
    }

    if (typeof rigidBodyRef.current.applyTorqueImpulse === 'function') {
      rigidBodyRef.current.applyTorqueImpulse(
        {
          x: result.torque.x * dtScale * 0.016,
          y: result.torque.y * dtScale * 0.016,
          z: result.torque.z * dtScale * 0.016,
        },
        true,
      );
    } else {
      rigidBodyRef.current.addTorque?.(result.torque, true);
    }
  });

  return lastForce;
};

export default useVortexForce;
