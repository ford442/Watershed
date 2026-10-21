import React, { createContext, useContext, useMemo, useRef } from 'react';
import * as THREE from 'three';

/**
 * How far from the camera `sunWorldPosition` sits. The old fixed sun points
 * were ~140 m from the origin; consumers that project or aim at the sun keep
 * the scale they were tuned for.
 */
export const SUN_DISTANCE = 140;

type SunPositionContextValue = {
  /**
   * A point toward the sun, `SUN_DISTANCE` from the camera (SkyClockTick moves
   * it every frame). For aiming from a nearby point — specular, god-ray
   * projection. Never normalize it as a direction: use `sunDirection`.
   */
  sunWorldPosition: THREE.Vector3;
  /** Unit vector toward the sun (the sky clock's). */
  sunDirection: THREE.Vector3;
};

const SunPositionContext = createContext<SunPositionContextValue | null>(null);

export const SunPositionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const sunWorldPosition = useRef(new THREE.Vector3(12, 35, 18));
  const sunDirection = useRef(new THREE.Vector3(12, 35, 18).normalize());

  // Stable refs, mutated in place by SkyClockTick: the context value never changes.
  const value = useMemo<SunPositionContextValue>(() => ({
    sunWorldPosition: sunWorldPosition.current,
    sunDirection: sunDirection.current,
  }), []);

  return (
    <SunPositionContext.Provider value={value}>
      {children}
    </SunPositionContext.Provider>
  );
};

export const useSunPosition = () => {
  const context = useContext(SunPositionContext);
  if (!context) throw new Error('useSunPosition must be used within SunPositionProvider');
  return context;
};
