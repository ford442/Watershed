/**
 * InputHubTick.tsx — drives the InputHub from the R3F frame loop (#486 A).
 *
 * Null component mounted inside the Canvas (and inside <KeyboardControls>).
 * Registers the keyboard/mouse source and ticks the hub once per frame at
 * useFrame priority −100, so every vehicle step this frame reads one snapshot.
 *
 * With `?input=script:<url>` it also loads the script into a ScriptedSource
 * (live once `isRunLive()` says the run started), holds the camera at the
 * script's `headingYaw` while it is live, and exposes the root's `advance()`
 * to `stepScripted(n)` for the headless harness.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { inputHub } from './InputHub';
import { KeyboardMouseSource } from './sources/KeyboardMouseSource';
import type { ScriptedSource } from './sources/ScriptedSource';
import { getInputScriptUrl, setScriptedStepper, stepRootFrames } from './scriptedRun';
import { useSettingsStore } from '../systems/settings/useSettingsStore';

/** Ahead of every default-priority (0) subscriber — vehicles, Rapier stepper. */
export const INPUT_HUB_PRIORITY = -100;

const getBindings = () => useSettingsStore.getState().bindings;
const neverLive = () => false;

export interface InputHubTickProps {
  /** Scripted runs only: true once the run is live (recording started, vehicle body up). */
  isRunLive?: () => boolean;
}

export function InputHubTick({ isRunLive = neverLive }: InputHubTickProps): null {
  const [, getKeys] = useKeyboardControls();
  const getRoot = useThree((s) => s.get);
  const frameIdxRef = useRef(0);
  const scriptedRef = useRef<ScriptedSource | null>(null);
  const isRunLiveRef = useRef(isRunLive);
  isRunLiveRef.current = isRunLive;

  useEffect(() => {
    const source = new KeyboardMouseSource(getKeys, getBindings);
    source.attach(window);
    inputHub.registerSource(source);
    return () => inputHub.unregisterSource(source.id, source);
  }, [getKeys]);

  useEffect(() => {
    const url = getInputScriptUrl();
    if (!url) return undefined;
    let cancelled = false;
    let source: ScriptedSource | null = null;
    // Dynamic import: only `?input=script:` pages need the source, so it stays off the boot path.
    Promise.all([
      import('./sources/ScriptedSource'),
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<unknown>;
      }),
    ])
      .then(([{ parseInputScript, ScriptedSource }, raw]) => {
        if (cancelled) return;
        source = new ScriptedSource(parseInputScript(raw), () => isRunLiveRef.current());
        inputHub.registerSource(source);
        scriptedRef.current = source;
      })
      .catch((err: unknown) => {
        console.error(`[InputHubTick] input script ${url} failed to load:`, err);
      });
    return () => {
      cancelled = true;
      if (source) inputHub.unregisterSource(source.id, source);
      if (scriptedRef.current === source) scriptedRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!getInputScriptUrl()) return undefined;
    setScriptedStepper((n) => stepRootFrames(getRoot, n));
    return () => setScriptedStepper(null);
  }, [getRoot]);

  useFrame((state, delta) => {
    frameIdxRef.current += 1;
    inputHub.tick(delta * 1000, frameIdxRef.current);

    const scripted = scriptedRef.current;
    const yaw = scripted?.script.headingYaw;
    if (yaw !== undefined && scripted!.isRunning()) {
      state.camera.rotation.set(0, yaw, 0, 'YXZ');
      state.camera.updateMatrixWorld();
    }
  }, INPUT_HUB_PRIORITY);

  return null;
}

export default InputHubTick;
