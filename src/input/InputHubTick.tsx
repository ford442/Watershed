/**
 * InputHubTick.tsx — drives the InputHub from the R3F frame loop (#486 A).
 *
 * Null component mounted inside the Canvas (and inside <KeyboardControls>).
 * Registers the keyboard/mouse and gamepad sources (and the touch source on a
 * touch device — #486 C) and ticks the hub once per frame at useFrame priority
 * −100, so every vehicle step this frame reads one snapshot. It also turns the
 * PAUSE bit's rising edge into a pause request (`pauseBus`), feeds the river's
 * flow rumble to the haptics, and applies gamepad/touch look to the camera.
 *
 * With `?input=script:<url>` it also loads the script into a ScriptedSource
 * (live once `isRunLive()` says the run started), holds the camera at the
 * script's `headingYaw` while it is live, and exposes the root's `advance()`
 * to `stepScripted(n)` for the headless harness.
 */

import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { inputHub, type InputSource } from './InputHub';
import { KeyboardMouseSource } from './sources/KeyboardMouseSource';
import { InputButton } from './InputFrame';
import { emitPauseRequest, pauseEdge } from './pauseBus';
import { InputLookApply } from './InputLookApply';
import { preloadHaptics, pulse, stopHaptics } from './haptics';
import { useGameStore } from '../systems/GameState';
import type { ScriptedSource } from './sources/ScriptedSource';
import { getInputScriptUrl, setScriptedStepper, stepRootFrames } from './scriptedRun';
import { useSettingsStore } from '../systems/settings/useSettingsStore';

/** Ahead of every default-priority (0) subscriber — vehicles, Rapier stepper. */
export const INPUT_HUB_PRIORITY = -100;

const getBindings = () => useSettingsStore.getState().bindings;
const getPadBindings = () => useSettingsStore.getState().padBindings;
// One object, refreshed in place each poll: the pad source reads this every frame.
const padTuning = { deadzone: 0.15, curve: 1 };
const getPadTuning = () => {
  const s = useSettingsStore.getState();
  padTuning.deadzone = s.gamepadDeadzone;
  padTuning.curve = s.gamepadCurve;
  return padTuning;
};

/** How often the flow rumble is re-issued, and the speed (m/s) at which it is full strength. */
const FLOW_HAPTIC_INTERVAL_MS = 180;
const FLOW_HAPTIC_FULL_SPEED = 28;
const FLOW_HAPTIC_MIN_SPEED = 3;
const neverLive = () => false;

export interface InputHubTickProps {
  /** Scripted runs only: true once the run is live (recording started, vehicle body up). */
  isRunLive?: () => boolean;
}

export function InputHubTick({ isRunLive = neverLive }: InputHubTickProps): React.ReactElement {
  const [, getKeys] = useKeyboardControls();
  const getRoot = useThree((s) => s.get);
  const frameIdxRef = useRef(0);
  const prevButtonsRef = useRef(0);
  const flowClockRef = useRef(0);
  const scriptedRef = useRef<ScriptedSource | null>(null);
  const isRunLiveRef = useRef(isRunLive);
  isRunLiveRef.current = isRunLive;

  useEffect(() => {
    const source = new KeyboardMouseSource(getKeys, getBindings);
    source.attach(window);
    inputHub.registerSource(source);
    return () => inputHub.unregisterSource(source.id, source);
  }, [getKeys]);

  // Gamepad: the source (and the rumble code) are fetched only once a pad exists
  // — Chrome reports one on its first button press — so keyboard and touch
  // players never download them.
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return undefined;
    let cancelled = false;
    let source: InputSource | null = null;
    let starting = false;
    const start = () => {
      if (source || starting || cancelled) return;
      starting = true;
      import('./sources/GamepadSource')
        .then(({ GamepadSource }) => {
          if (cancelled) return;
          const pad = new GamepadSource(getPadBindings, getPadTuning);
          pad.attach(window);
          inputHub.registerSource(pad);
          source = pad;
          preloadHaptics();
        })
        .catch((err: unknown) => console.error('[InputHubTick] gamepad source failed to load:', err))
        .finally(() => {
          starting = false;
        });
    };
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i += 1) if (pads[i]?.connected) start();
    window.addEventListener('gamepadconnected', start);
    return () => {
      cancelled = true;
      window.removeEventListener('gamepadconnected', start);
      if (source) inputHub.unregisterSource(source.id, source);
    };
  }, []);

  // Wipeout rumble, and silence on pause / menu (isPaused covers both).
  useEffect(
    () =>
      useGameStore.subscribe((state, prev) => {
        if (state.isWipeout && !prev.isWipeout) pulse('wipeout');
        else if (state.isPaused && !prev.isPaused) stopHaptics();
      }),
    [],
  );

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

    const buttons = inputHub.readFrame().buttons;
    // Only a running game pauses. While paused or in a menu the same Start press
    // belongs to the menu (it resumes), and letting the hub also emit would race
    // the menu's resume within one frame and re-pause the game.
    if (pauseEdge(prevButtonsRef.current, buttons, InputButton.PAUSE) && !useGameStore.getState().isPaused) {
      emitPauseRequest();
    }
    prevButtonsRef.current = buttons;

    // The river's pull, as a low rumble a few times a second. Cheap when idle:
    // `pulse` returns at its first gate unless a gamepad is the active device.
    flowClockRef.current += delta * 1000;
    if (flowClockRef.current >= FLOW_HAPTIC_INTERVAL_MS) {
      flowClockRef.current = 0;
      const speed = useGameStore.getState().currentSpeed;
      if (speed > FLOW_HAPTIC_MIN_SPEED) pulse('flow', Math.min(1, speed / FLOW_HAPTIC_FULL_SPEED));
    }

    const scripted = scriptedRef.current;
    const yaw = scripted?.script.headingYaw;
    if (yaw !== undefined && scripted!.isRunning()) {
      state.camera.rotation.set(0, yaw, 0, 'YXZ');
      state.camera.updateMatrixWorld();
    }
  }, INPUT_HUB_PRIORITY);

  return <InputLookApply />;
}

export default InputHubTick;
