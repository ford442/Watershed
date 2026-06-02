import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface ShakeEvent {
  intensity: number;
  duration: number;
}

/**
 * useCameraShake - Hook that listens for camera shake events
 * 
 * Listens for 'camera-shake' CustomEvent on window and applies
 * shake offset to the camera during the specified duration.
 */
export function useCameraShake() {
  const { camera } = useThree();
  const shakeRef = useRef<ShakeEvent | null>(null);
  const shakeTimeRef = useRef(0);
  const originalPosition = useRef(new THREE.Vector3());
  const rumbleIntensityRef = useRef(0);

  useEffect(() => {
    const handleShake = (event: Event) => {
      const customEvent = event as CustomEvent<ShakeEvent>;
      const { intensity, duration } = customEvent.detail;
      
      shakeRef.current = { intensity, duration };
      shakeTimeRef.current = 0;
      originalPosition.current.copy(camera.position);
    };

    const handleRumble = (event: Event) => {
      const customEvent = event as CustomEvent<{ intensity: number }>;
      rumbleIntensityRef.current = Math.max(0, customEvent.detail?.intensity ?? 0);
    };

    window.addEventListener('camera-shake', handleShake);
    window.addEventListener('camera-rumble', handleRumble);
    return () => {
      window.removeEventListener('camera-shake', handleShake);
      window.removeEventListener('camera-rumble', handleRumble);
    };
  }, [camera]);

  return {
    shakeRef,
    shakeTimeRef,
    originalPosition,
    update: (delta: number) => {
      let transientIntensity = 0;

      if (shakeRef.current) {
        shakeTimeRef.current += delta;

        if (shakeTimeRef.current >= shakeRef.current.duration) {
          shakeRef.current = null;
        } else {
          const progress = shakeTimeRef.current / shakeRef.current.duration;
          transientIntensity = shakeRef.current.intensity * (1 - progress);
        }
      }

      const ambientIntensity = rumbleIntensityRef.current;
      const intensity = transientIntensity + ambientIntensity;
      if (intensity <= 0) return;

      const time = (shakeTimeRef.current + delta) * 20;
      const offsetX = (Math.sin(time * 1.3) + Math.sin(time * 2.7)) * 0.5 * intensity * 0.3;
      const offsetY = (Math.cos(time * 1.7) + Math.cos(time * 2.3)) * 0.5 * intensity * 0.3;
      const offsetZ = (Math.sin(time * 2.1) + Math.cos(time * 3.1)) * 0.5 * intensity * 0.2;

      camera.position.x = originalPosition.current.x + offsetX;
      camera.position.y = originalPosition.current.y + offsetY;
      camera.position.z = originalPosition.current.z + offsetZ;
    }
  };
}
