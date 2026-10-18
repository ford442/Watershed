/**
 * InputHubTick.tsx — drives the InputHub from the R3F frame loop (#486 A).
 *
 * Null component mounted inside the Canvas (and inside <KeyboardControls>).
 * Registers the keyboard/mouse source and ticks the hub once per frame at
 * useFrame priority −100, so every vehicle step this frame reads one snapshot.
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { inputHub } from './InputHub';
import { KeyboardMouseSource } from './sources/KeyboardMouseSource';
import { useSettingsStore } from '../systems/settings/useSettingsStore';

/** Ahead of every default-priority (0) subscriber — vehicles, Rapier stepper. */
export const INPUT_HUB_PRIORITY = -100;

const getBindings = () => useSettingsStore.getState().bindings;

export function InputHubTick(): null {
  const [, getKeys] = useKeyboardControls();
  const frameIdxRef = useRef(0);

  useEffect(() => {
    const source = new KeyboardMouseSource(getKeys, getBindings);
    source.attach(window);
    inputHub.registerSource(source);
    return () => inputHub.unregisterSource(source.id, source);
  }, [getKeys]);

  useFrame((_, delta) => {
    frameIdxRef.current += 1;
    inputHub.tick(delta * 1000, frameIdxRef.current);
  }, INPUT_HUB_PRIORITY);

  return null;
}

export default InputHubTick;
