import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import * as THREE from 'three';

type SunPositionContextValue = {
  sunWorldPosition: THREE.Vector3;
  setSunWorldPosition: (position: THREE.Vector3 | [number, number, number]) => void;
};

const SunPositionContext = createContext<SunPositionContextValue | null>(null);

export const SunPositionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const sunWorldPosition = useRef(new THREE.Vector3(12, 35, 18));

  const setSunWorldPosition = useCallback((position: THREE.Vector3 | [number, number, number]) => {
    if (Array.isArray(position)) {
      sunWorldPosition.current.set(position[0], position[1], position[2]);
      return;
    }
    sunWorldPosition.current.copy(position);
  }, []);

  const value = useMemo<SunPositionContextValue>(() => ({
    sunWorldPosition: sunWorldPosition.current,
    setSunWorldPosition,
  }), [setSunWorldPosition]);

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

