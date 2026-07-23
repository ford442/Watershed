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
import { useSettingsStore } from '../systems/useSettingsStore';
import { bindingsToMouseMap, type SettingsAction } from '../systems/settingsDerive';

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
  // Pressed mouse buttons ('Mouse0'|'Mouse1'|'Mouse2') for mouse-bound actions
  // (e.g. right-click-forward). Read transiently in getControls.
  const mouseButtonsRef = useRef<Set<string>>(new Set());
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

  // Mouse-button bindings (right-click-forward etc.). Track pressed buttons and
  // suppress the context menu while any mouse button is a binding so a bound
  // right-click drives movement instead of popping the browser menu.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      mouseButtonsRef.current.add(`Mouse${e.button}`);
    };
    const onMouseUp = (e: MouseEvent) => {
      mouseButtonsRef.current.delete(`Mouse${e.button}`);
    };
    const clear = () => mouseButtonsRef.current.clear();
    const onContextMenu = (e: MouseEvent) => {
      const mouseMap = bindingsToMouseMap(useSettingsStore.getState().bindings);
      if (Object.values(mouseMap).includes('Mouse2')) e.preventDefault();
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', clear);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', clear);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // Imperative accessor — safe to call inside useFrame every tick
  const getControls = useCallback((): PlayerControls => {
    const keys = getKeys();
    const extra = extraKeysRef.current;

    // Base state from the drei KeyboardControls map (rebindable keys).
    const state: Record<SettingsAction, boolean> = {
      forward: keys.forward ?? false,
      backward: keys.backward ?? false,
      leftward: keys.leftward ?? false,
      rightward: keys.rightward ?? false,
      jump: keys.jump ?? false,
      // Sprint/dodge now flow through the rebindable map; keep the legacy raw
      // Shift/Alt refs as a fallback so held modifiers still register.
      sprint: (keys as Record<string, boolean>).sprint || extra.shift,
      brake: (keys as Record<string, boolean>).brake ?? false,
      dodge: (keys as Record<string, boolean>).dodge || extra.alt,
    };

    // Merge mouse-bound actions (e.g. right-click-forward).
    const pressed = mouseButtonsRef.current;
    if (pressed.size > 0) {
      const mouseMap = bindingsToMouseMap(useSettingsStore.getState().bindings);
      for (const action of Object.keys(mouseMap) as SettingsAction[]) {
        const code = mouseMap[action];
        if (code && pressed.has(code)) state[action] = true;
      }
    }

    return {
      ...state,
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
