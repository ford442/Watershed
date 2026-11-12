/**
 * usePlayerControls.ts — vehicle-facing adapter over the InputHub (#486 A).
 *
 * Devices live in `src/input/` now: sources write into the InputHub, which
 * `<InputHubTick />` ticks once per frame ahead of every vehicle. This hook
 * keeps the old `PlayerControls` shape for the runner and raft steps:
 * `getControls()` fills one preallocated object from `inputHub.readFrame()`
 * (no spread, no allocation), so repeated calls in one frame return the same
 * object holding the same snapshot.
 *
 * `forwardDir` / `rightDir` are stable vectors refreshed in place on render.
 * `isPointerLocked` stays React state for UI; no vehicle gates on it.
 *
 * New code reads the frame directly with `useInputFrame()`.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { inputHub } from '../input/InputHub';
import type { InputFrame } from '../input/InputFrame';
import { createPlayerControls, fillPlayerControls, type PlayerControls } from '../input/playerControls';


export interface PlayerControlVectors {
  /** Camera-relative forward direction (XZ plane, normalized) */
  forwardDir: THREE.Vector3;
  /** Camera-relative right direction (XZ plane, normalized) */
  rightDir: THREE.Vector3;
}

/** This frame's merged input. The same object every call; read it, never keep a field across frames. */
export function useInputFrame(): Readonly<InputFrame> {
  return inputHub.readFrame();
}

/**
 * @deprecated Read `useInputFrame()` in new code. Kept as the adapter for the
 * runner / raft steps until #486 B–D retire the last caller.
 *
 * @param camera — Three.js camera (for the camera-relative vectors)
 */
export function usePlayerControls(camera?: THREE.Camera): PlayerControlVectors & { getControls: () => PlayerControls } {
  // State (not just the ref) so a lock change still re-renders the host, as before.
  const [, setIsPointerLocked] = useState(false);
  const lockedRef = useRef(false);
  const controlsRef = useRef<PlayerControls | null>(null);
  if (controlsRef.current === null) controlsRef.current = createPlayerControls();

  // Track pointer lock state (low frequency, OK to use state)
  useEffect(() => {
    const handleLockChange = () => {
      lockedRef.current = !!document.pointerLockElement;
      setIsPointerLocked(lockedRef.current);
    };
    document.addEventListener('pointerlockchange', handleLockChange);
    handleLockChange();
    return () => document.removeEventListener('pointerlockchange', handleLockChange);
  }, []);

  // Imperative accessor — safe to call inside useFrame every tick
  const getControls = useCallback(
    (): PlayerControls => fillPlayerControls(inputHub.readFrame(), lockedRef.current, controlsRef.current!),
    [],
  );

  // Camera-relative direction vectors, stable instances refreshed in place.
  const forwardDir = useRef<THREE.Vector3 | null>(null);
  const rightDir = useRef<THREE.Vector3 | null>(null);
  if (forwardDir.current === null) forwardDir.current = new THREE.Vector3(0, 0, -1);
  if (rightDir.current === null) rightDir.current = new THREE.Vector3(1, 0, 0);

  if (camera) {
    camera.getWorldDirection(forwardDir.current);
    forwardDir.current.y = 0;
    if (forwardDir.current.lengthSq() > 0.001) {
      forwardDir.current.normalize();
    }
    rightDir.current.crossVectors(forwardDir.current, camera.up).normalize();
  }

  return {
    forwardDir: forwardDir.current,
    rightDir: rightDir.current,
    getControls,
  };
}
