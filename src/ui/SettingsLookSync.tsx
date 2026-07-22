/**
 * SettingsLookSync.tsx — Applies mouse-look settings to the active
 * PointerLockControls. Mounted inside the R3F tree next to <PointerLockControls>.
 *
 * - Sensitivity → `controls.pointerSpeed` (native, live).
 * - Invert-Y → a capture-phase mousemove that pre-rotates the camera pitch by
 *   +2·Δy before PointerLockControls subtracts Δy, netting an inverted vertical.
 *   PointerLockControls recomputes its euler from the (now pre-rotated) camera
 *   quaternion each move, so the two compose cleanly with no custom controller.
 *
 * Settings are read transiently (getState) so slider drags never re-render the
 * scene subtree.
 */

import { useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSettingsStore } from '../systems/useSettingsStore';

const HALF_PI = Math.PI / 2;

/* eslint-disable react-hooks/exhaustive-deps */

export default function SettingsLookSync() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | (THREE.Object3D & { pointerSpeed?: number })
    | null;

  // Live sensitivity → pointerSpeed.
  useFrame(() => {
    if (controls && 'pointerSpeed' in controls) {
      controls.pointerSpeed = useSettingsStore.getState().mouseSensitivity;
    }
  });

  // Invert-Y counter-rotation.
  useEffect(() => {
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const onMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      const s = useSettingsStore.getState();
      if (!s.invertY) return;
      const movementY = e.movementY || 0;
      if (movementY === 0) return;
      euler.setFromQuaternion(camera.quaternion);
      euler.x += 2 * movementY * 0.002 * s.mouseSensitivity;
      euler.x = Math.max(-HALF_PI, Math.min(HALF_PI, euler.x));
      camera.quaternion.setFromEuler(euler);
    };
    // Capture phase so we run before PointerLockControls' document handler.
    window.addEventListener('mousemove', onMove, true);
    return () => window.removeEventListener('mousemove', onMove, true);
  }, [camera]);

  return null;
}
