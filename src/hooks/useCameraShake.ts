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

  useEffect(() => {
    const handleShake = (event: Event) => {
      const customEvent = event as CustomEvent<ShakeEvent>;
      const { intensity, duration } = customEvent.detail;
      
      shakeRef.current = { intensity, duration };
      shakeTimeRef.current = 0;
      originalPosition.current.copy(camera.position);
    };

    window.addEventListener('camera-shake', handleShake);
    return () => window.removeEventListener('camera-shake', handleShake);
  }, [camera]);

  return {
    shakeRef,
    shakeTimeRef,
    originalPosition,
    update: (delta: number) => {
      if (!shakeRef.current) return;

      shakeTimeRef.current += delta;
      
      if (shakeTimeRef.current >= shakeRef.current.duration) {
        // Shake complete
        shakeRef.current = null;
        return;
      }

      // Calculate shake decay (strong at start, fades out)
      const progress = shakeTimeRef.current / shakeRef.current.duration;
      const decay = 1 - progress;
      const intensity = shakeRef.current.intensity * decay;

      // Perlin-like noise for smooth shake
      const time = shakeTimeRef.current * 20; // Shake frequency
      const offsetX = (Math.sin(time * 1.3) + Math.sin(time * 2.7)) * 0.5 * intensity * 0.3;
      const offsetY = (Math.cos(time * 1.7) + Math.cos(time * 2.3)) * 0.5 * intensity * 0.3;
      const offsetZ = (Math.sin(time * 2.1) + Math.cos(time * 3.1)) * 0.5 * intensity * 0.2;

      // Apply shake offset to camera
      camera.position.x = originalPosition.current.x + offsetX;
      camera.position.y = originalPosition.current.y + offsetY;
      camera.position.z = originalPosition.current.z + offsetZ;
    }
  };
}
