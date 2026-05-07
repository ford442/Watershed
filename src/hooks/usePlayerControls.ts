/**
 * usePlayerControls.ts — Unified input hook for all vehicle types
 *
 * RESPONSIBILITIES:
 * - Abstract keyboard/mouse input into a single reactive interface
 * - Support runner (WASD + jump + sprint) and raft (WASD + paddle Q/E) controls
 * - Provide camera-relative direction vectors for runner movement
 * - Gate input when pointer lock is not active (prevents stuck keys)
 *
 * DESIGN:
 * - Uses @react-three/drei useKeyboardControls for mapped keys.
 * - Adds raw window event listeners for keys not in the KeyboardControls map
 *   (Q/E paddle, Shift sprint).
 * - Raw key state is stored in refs so useFrame callbacks always read fresh
 *   values without waiting for a React re-render.
 * - isPointerLocked is in state so UI can subscribe to it.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';

export interface PlayerControls {
  /** Forward input (W / ArrowUp) */
  forward: boolean;
  /** Backward input (S / ArrowDown) */
  backward: boolean;
  /** Left strafe (A / ArrowLeft) */
  leftward: boolean;
  /** Right strafe (D / ArrowRight) */
  rightward: boolean;
  /** Jump (Space) */
  jump: boolean;
  /** Sprint / boost (Shift) */
  sprint: boolean;
  /** Brake (not currently mapped, reserved) */
  brake: boolean;
  /** Dodge / dash (Alt or double-tap direction) */
  dodge: boolean;
  /** Left paddle (Q) — raft only */
  paddleLeft: boolean;
  /** Right paddle (E) — raft only */
  paddleRight: boolean;
  /** Is pointer lock currently active */
  isPointerLocked: boolean;
}

export interface PlayerControlVectors {
  /** Camera-relative forward direction (XZ plane, normalized) */
  forwardDir: THREE.Vector3;
  /** Camera-relative right direction (XZ plane, normalized) */
  rightDir: THREE.Vector3;
}

/**
 * Hook that provides unified player input state.
 *
 * @param camera — Three.js camera instance (needed for camera-relative vectors)
 * @returns Object with:
 *   - Reactive `isPointerLocked` for UI
 *   - `getControls()` imperative accessor for useFrame (always fresh)
 *   - `forwardDir` / `rightDir` camera-relative vectors
 */
export function usePlayerControls(camera?: THREE.Camera): PlayerControlVectors & { getControls: () => PlayerControls } {
  const [, getKeys] = useKeyboardControls();

  // Refs for high-frequency keys — always fresh inside useFrame
  const extraKeysRef = useRef({ q: false, e: false, shift: false, alt: false });
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  // Track pointer lock state (low frequency, OK to use state)
  useEffect(() => {
    const handleLockChange = () => {
      setIsPointerLocked(!!document.pointerLockElement);
    };
    document.addEventListener('pointerlockchange', handleLockChange);
    handleLockChange();
    return () => document.removeEventListener('pointerlockchange', handleLockChange);
  }, []);

  // Raw window listeners for Q/E paddle keys and Shift sprint
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'q') extraKeysRef.current.q = true;
      if (key === 'e') extraKeysRef.current.e = true;
      if (key === 'shift') extraKeysRef.current.shift = true;
      if (key === 'alt') extraKeysRef.current.alt = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'q') extraKeysRef.current.q = false;
      if (key === 'e') extraKeysRef.current.e = false;
      if (key === 'shift') extraKeysRef.current.shift = false;
      if (key === 'alt') extraKeysRef.current.alt = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Imperative accessor — safe to call inside useFrame every tick
  const getControls = useCallback((): PlayerControls => {
    const keys = getKeys();
    const extra = extraKeysRef.current;
    return {
      forward: keys.forward ?? false,
      backward: keys.backward ?? false,
      leftward: keys.leftward ?? false,
      rightward: keys.rightward ?? false,
      jump: keys.jump ?? false,
      sprint: extra.shift,
      brake: false, // Reserved for future mapping
      dodge: (keys as any).dodge || extra.alt,
      paddleLeft: extra.q,
      paddleRight: extra.e,
      isPointerLocked,
    };
  }, [getKeys, isPointerLocked]);

  // Camera-relative direction vectors
  const forwardDir = useRef(new THREE.Vector3(0, 0, -1));
  const rightDir = useRef(new THREE.Vector3(1, 0, 0));

  if (camera) {
    camera.getWorldDirection(forwardDir.current);
    forwardDir.current.y = 0;
    if (forwardDir.current.lengthSq() > 0.001) {
      forwardDir.current.normalize();
    }
    rightDir.current.crossVectors(forwardDir.current, camera.up).normalize();
  }

  return {
    forwardDir: forwardDir.current.clone(),
    rightDir: rightDir.current.clone(),
    getControls,
  };
}

export default usePlayerControls;
