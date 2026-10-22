/**
 * hapticsImpl.ts — gamepad rumble for the river (#486 B).
 *
 * Loaded on demand by the `haptics.ts` facade the first time a gamepad is the
 * active device, so a keyboard player never downloads it.
 *
 * `pulse(kind, scale)` plays one of three authored envelopes through
 * `GamepadHapticActuator.playEffect('dual-rumble', …)`:
 *
 *   flow     a soft, even rumble in both motors — the river's pull. The feeder
 *            re-issues it a few times a second while the player moves.
 *   impact   one sharp heavy-motor hit with a short tail — a wall, a landing,
 *            a splash entry.
 *   wipeout  a long decaying double surge.
 *
 * The browser keeps one effect per actuator (a new `playEffect` preempts the
 * last), so an envelope is a list of timed steps this module walks with
 * timeouts rather than several queued effects; a lower-priority pulse never
 * cuts a higher one short (wipeout > impact > flow).
 *
 * Gates, in `shouldPulse`: the settings must allow it, the game must not be
 * paused or in a menu (`GameState.isPaused` is true for both), and the last
 * device the player used must be the gamepad — a keyboard player with a pad in
 * the drawer feels nothing.
 *
 * Events, not frames: nothing here runs per frame except `shouldPulse`'s reads.
 */

import { useGameStore } from '../systems/GameState';
import { useSettingsStore } from '../systems/settings/useSettingsStore';
import { useInputStore } from './InputHub';
import { getActivePadIndex } from './activePad';
import type { InputSourceId } from './InputFrame';

export type HapticKind = 'flow' | 'impact' | 'wipeout';

/** One `playEffect` call: starts `atMs` after the pulse, lasts `durationMs`. */
export interface HapticStep {
  atMs: number;
  durationMs: number;
  /** High-frequency (weak) motor, 0..1. */
  weak: number;
  /** Low-frequency (strong) motor, 0..1. */
  strong: number;
}

/** The authored envelopes. Magnitudes are at scale 1 and strength 1. */
export const HAPTIC_ENVELOPES: Readonly<Record<HapticKind, readonly HapticStep[]>> = {
  flow: [{ atMs: 0, durationMs: 160, weak: 0.14, strong: 0.2 }],
  impact: [
    { atMs: 0, durationMs: 70, weak: 0.6, strong: 1.0 },
    { atMs: 70, durationMs: 110, weak: 0.25, strong: 0.45 },
  ],
  wipeout: [
    { atMs: 0, durationMs: 200, weak: 0.9, strong: 1.0 },
    { atMs: 200, durationMs: 160, weak: 0.4, strong: 0.7 },
    { atMs: 380, durationMs: 240, weak: 0.7, strong: 0.85 },
    { atMs: 620, durationMs: 380, weak: 0.25, strong: 0.4 },
  ],
};

/** Higher wins; equal restarts. */
export const HAPTIC_PRIORITY: Readonly<Record<HapticKind, number>> = { flow: 0, impact: 1, wipeout: 2 };

export function envelopeDurationMs(kind: HapticKind): number {
  const steps = HAPTIC_ENVELOPES[kind];
  let end = 0;
  for (let i = 0; i < steps.length; i += 1) end = Math.max(end, steps[i].atMs + steps[i].durationMs);
  return end;
}

export interface HapticGate {
  enabled: boolean;
  strength: number;
  /** `GameState.isPaused` — true while paused *and* on the start menu. */
  paused: boolean;
  activeSource: InputSourceId;
}

/** The single rule for whether a pulse may fire. */
export function shouldPulse(g: HapticGate): boolean {
  return g.enabled && g.strength > 0 && !g.paused && g.activeSource === 'gamepad';
}

/** A step with scale and strength applied, clamped to the actuator's 0..1. */
export function scaleStep(step: HapticStep, scale: number, strength: number): HapticStep {
  const k = Math.max(0, Math.min(1, scale)) * Math.max(0, Math.min(1, strength));
  return {
    atMs: step.atMs,
    durationMs: step.durationMs,
    weak: Math.min(1, step.weak * k),
    strong: Math.min(1, step.strong * k),
  };
}

interface Actuator {
  playEffect(type: string, params: Record<string, number>): Promise<unknown>;
  reset?(): Promise<unknown>;
}

function activeActuator(): Actuator | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  const pads = navigator.getGamepads();
  const idx = getActivePadIndex();
  const pad = idx >= 0 ? pads[idx] : null;
  const actuator = (pad as (Gamepad & { vibrationActuator?: Actuator }) | null)?.vibrationActuator;
  return actuator ?? null;
}

let timers: ReturnType<typeof setTimeout>[] = [];
let playingKind: HapticKind | null = null;
let playingUntil = 0;

function clearTimers(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

/** Stop any rumble now (pause, menu, wipeout screen, device switch). */
export function stopHaptics(): void {
  clearTimers();
  playingKind = null;
  playingUntil = 0;
  void activeActuator()?.reset?.()?.catch?.(() => undefined);
}

function play(actuator: Actuator, step: HapticStep): void {
  actuator
    .playEffect('dual-rumble', {
      startDelay: 0,
      duration: step.durationMs,
      weakMagnitude: step.weak,
      strongMagnitude: step.strong,
    })
    ?.catch?.(() => undefined);
}

/**
 * Play an envelope. `scale` (0..1) is how hard: an impact passes its force, the
 * flow feeder passes the river's strength. Returns true when a rumble started.
 */
export function pulse(kind: HapticKind, scale: number = 1): boolean {
  // Cheapest gate first: most players never have a gamepad as the active device.
  if (useInputStore.getState().activeSourceId !== 'gamepad') return false;
  const settings = useSettingsStore.getState();
  const allowed = shouldPulse({
    enabled: settings.hapticsEnabled,
    strength: settings.hapticsStrength,
    paused: useGameStore.getState().isPaused,
    activeSource: useInputStore.getState().activeSourceId,
  });
  if (!allowed) return false;

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (playingKind !== null && now < playingUntil && HAPTIC_PRIORITY[kind] < HAPTIC_PRIORITY[playingKind]) {
    return false;
  }
  const actuator = activeActuator();
  if (!actuator) return false;

  clearTimers();
  const steps = HAPTIC_ENVELOPES[kind];
  for (let i = 0; i < steps.length; i += 1) {
    const step = scaleStep(steps[i], scale, settings.hapticsStrength);
    if (step.atMs <= 0) play(actuator, step);
    else timers.push(setTimeout(() => play(actuator, step), step.atMs));
  }
  playingKind = kind;
  playingUntil = now + envelopeDurationMs(kind);
  return true;
}
