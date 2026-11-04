/**
 * InputLookApply.tsx — turns the hub's look axes into camera rotation (#486 B).
 *
 * The mouse looks through `PointerLockControls`; the gamepad's right stick and
 * the touch look-drag report mouse-equivalent pixels in `InputFrame.lookDX/DY`.
 * This applies them with the same maths `PointerLockControls` uses (YXZ euler,
 * 0.002 rad per pixel, pitch clamped), scaled by the player's look sensitivity
 * and honouring invert-Y — so every device feels like the one the sensitivity
 * slider was tuned on.
 *
 * Null component, `useFrame` priority −99: after the hub tick (−100), before
 * every vehicle step that reads the camera direction.
 */

import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { inputHub } from './InputHub';
import { useSettingsStore } from '../systems/settings/useSettingsStore';

export const INPUT_LOOK_PRIORITY = -99;

/** Radians per mouse-equivalent pixel — PointerLockControls' constant. */
const RAD_PER_PX = 0.002;
const MAX_PITCH = Math.PI / 2 - 0.01;

/**
 * Rotate `euler` (YXZ) by a look delta. Positive `dx` turns right, positive
 * `dy` looks down — a mouse moving right / down — unless `invertY`.
 */
export function applyLookDelta(
  euler: THREE.Euler,
  dx: number,
  dy: number,
  sensitivity: number,
  invertY: boolean,
): THREE.Euler {
  euler.y -= dx * RAD_PER_PX * sensitivity;
  euler.x -= dy * RAD_PER_PX * sensitivity * (invertY ? -1 : 1);
  euler.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, euler.x));
  return euler;
}

const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export function InputLookApply(): null {
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    const f = inputHub.readFrame();
    if (f.lookDX === 0 && f.lookDY === 0) return;
    const s = useSettingsStore.getState();
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    applyLookDelta(euler, f.lookDX, f.lookDY, s.mouseSensitivity, s.invertY);
    camera.quaternion.setFromEuler(euler);
  }, INPUT_LOOK_PRIORITY);

  return null;
}
