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
import { InputButton, type InputFrame } from '../input/InputFrame';

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
  /** Brake / slide */
  brake: boolean;
  /** Dodge / dash (Alt) */
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

/** Axis magnitude that counts as a held digital direction. */
const AXIS_PRESSED = 0.5;

/** Fill `out` from a hub frame. Pure, allocation-free. */
export function fillPlayerControls(
  frame: Readonly<InputFrame>,
  isPointerLocked: boolean,
  out: PlayerControls,
): PlayerControls {
  const b = frame.buttons;
  out.forward = frame.moveY > AXIS_PRESSED;
  out.backward = frame.moveY < -AXIS_PRESSED;
  out.leftward = frame.moveX < -AXIS_PRESSED;
  out.rightward = frame.moveX > AXIS_PRESSED;
  out.jump = (b & InputButton.JUMP) !== 0;
  out.sprint = (b & InputButton.SPRINT) !== 0;
  out.brake = (b & InputButton.BRAKE) !== 0;
  out.dodge = (b & InputButton.DODGE) !== 0;
  out.paddleLeft = frame.paddleL > AXIS_PRESSED;
  out.paddleRight = frame.paddleR > AXIS_PRESSED;
  out.isPointerLocked = isPointerLocked;
  return out;
}

export function createPlayerControls(): PlayerControls {
  return {
    forward: false,
    backward: false,
    leftward: false,
    rightward: false,
    jump: false,
    sprint: false,
    brake: false,
    dodge: false,
    paddleLeft: false,
    paddleRight: false,
    isPointerLocked: false,
  };
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

export default usePlayerControls;
