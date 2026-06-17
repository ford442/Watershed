import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface ShakeEvent {
  intensity: number;
  duration: number;
  /** Oscillation frequency — lower = heavier/slower (waterfall uses 8, default 20) */
  frequency?: number;
  /** Max rotation roll amplitude in radians (waterfall uses 0.03, default 0) */
  angular?: number;
}

/**
 * useCameraShake — spring-damped camera shake with optional angular roll.
 *
 * Design:
 * - Undo/redo offset each frame so vehicle movement composites cleanly.
 * - Squared-progress decay: snappier punch, smoother tail-off vs linear.
 * - Separate rumble channel for continuous low-intensity tremor.
 * - Angular roll driven by low-frequency sine — gives waterfall plunge "tumble" feel.
 *
 * WGSL migration: when camera is managed on the GPU side, this hook should
 * write to a uniform buffer read by the vertex stage rather than mutating
 * camera.position directly.
 */
export function useCameraShake() {
  const { camera } = useThree();
  const shakeRef = useRef<ShakeEvent | null>(null);
  const shakeTimeRef = useRef(0);
  // Accumulated offsets from the previous frame, undone at next update start
  const shakeOffset = useRef(new THREE.Vector3());
  const rollOffset = useRef(0);
  const rumbleIntensityRef = useRef(0);

  useEffect(() => {
    const handleShake = (event: Event) => {
      const e = event as CustomEvent<ShakeEvent>;
      const { intensity, duration, frequency = 20, angular = 0 } = e.detail;
      shakeRef.current = { intensity, duration, frequency, angular };
      shakeTimeRef.current = 0;
    };

    const handleRumble = (event: Event) => {
      const e = event as CustomEvent<{ intensity: number }>;
      rumbleIntensityRef.current = Math.max(0, e.detail?.intensity ?? 0);
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
    shakeOffset,
    rollOffset,
    update: (delta: number) => {
      // Guard against malformed camera state that can be introduced by rapid
      // teleports or physics glitches. Mutating a non-finite camera position
      // permanently corrupts camera.matrixWorld and propagates to the attached
      // AudioListener and reflection renderer.
      const isFiniteVec3 = (v: THREE.Vector3) =>
        Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
      const isFiniteEuler = (e: THREE.Euler) =>
        Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z);

      if (!isFiniteVec3(camera.position) || !isFiniteEuler(camera.rotation)) {
        shakeOffset.current.set(0, 0, 0);
        rollOffset.current = 0;
        return;
      }
      if (!isFiniteVec3(shakeOffset.current) || !Number.isFinite(rollOffset.current)) {
        shakeOffset.current.set(0, 0, 0);
        rollOffset.current = 0;
      }
      if (!Number.isFinite(delta) || delta < 0) {
        delta = 0;
      }

      // ── 1. Undo last frame's offset (allows vehicle lerp to compose underneath) ──
      camera.position.sub(shakeOffset.current);
      camera.rotation.z -= rollOffset.current;

      let transientIntensity = 0;
      let freq = 20;
      let angularAmp = 0;

      if (shakeRef.current) {
        shakeTimeRef.current += delta;
        if (shakeTimeRef.current >= shakeRef.current.duration) {
          shakeRef.current = null;
        } else {
          const progress = shakeTimeRef.current / shakeRef.current.duration;
          // Squared decay: punchy start, graceful tail-off
          transientIntensity = shakeRef.current.intensity * Math.pow(1 - progress, 2);
          freq = shakeRef.current.frequency ?? 20;
          angularAmp = shakeRef.current.angular ?? 0;
        }
      }

      const ambientIntensity = rumbleIntensityRef.current;
      let intensity = transientIntensity + ambientIntensity;
      if (!Number.isFinite(intensity)) {
        intensity = 0;
      }

      if (intensity <= 0) {
        shakeOffset.current.set(0, 0, 0);
        rollOffset.current = 0;
        return;
      }

      // ── 2. Compute new offsets ─────────────────────────────────────────────────
      const t = shakeTimeRef.current * freq;
      const posAmp = intensity * 0.3;

      // Two-frequency superposition per axis — avoids regular periodicity
      const offsetX = (Math.sin(t * 1.3) + Math.sin(t * 2.7)) * 0.5 * posAmp;
      const offsetY = (Math.cos(t * 1.7) + Math.cos(t * 2.3)) * 0.5 * posAmp;
      const offsetZ = (Math.sin(t * 2.1) + Math.cos(t * 3.1)) * 0.5 * posAmp * 0.65;

      // Angular roll: low-frequency sine driven by transient shake only
      const roll = transientIntensity > 0
        ? Math.sin(t * 0.55) * angularAmp * transientIntensity
        : 0;

      // ── 3. Apply and store for next-frame undo ─────────────────────────────────
      shakeOffset.current.set(offsetX, offsetY, offsetZ);
      rollOffset.current = roll;
      camera.position.add(shakeOffset.current);
      camera.rotation.z += rollOffset.current;
    }
  };
}
