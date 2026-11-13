/**
 * accessRuntime.ts — the live access values the sim and the HUD read (#558).
 *
 * Store-free on purpose: SimCore's systems (headless in Node, #556) must not
 * import a Zustand store, so SettingsSync pushes the player's settings here and
 * the step reads plain fields. A headless run never pushes, so it runs with no
 * assists and the authored palette — exactly what `main` did.
 *
 * Run assists are sticky: every assist that was on at any moment of a run is in
 * `getRunAssistBits()` until the next `beginRunAssists()`. Turning an assist off
 * in the pause menu does not make the run comparable again.
 */

import {
  AUTHORED_PALETTE,
  NO_ASSISTS,
  assistBits,
  type AccessPalette,
  type AssistSettings,
  type ColorVisionMode,
  type HoldMode,
} from './access';

const live: AssistSettings = { ...NO_ASSISTS };
let runBits = 0;
let colorVision: ColorVisionMode = 'off';
let palette: Readonly<AccessPalette> = AUTHORED_PALETTE;
let captions = false;
const holdModes: Record<'sprint' | 'brake' | 'paddle', HoldMode> = { sprint: 'hold', brake: 'hold', paddle: 'hold' };
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** SettingsSync: the player's assists changed. */
export function setLiveAssists(next: Readonly<AssistSettings>): void {
  live.gameSpeed = next.gameSpeed;
  live.nonLethal = next.nonLethal;
  live.guideRibbon = next.guideRibbon;
  live.autoJump = next.autoJump;
  runBits |= assistBits(live);
  notify();
}

/** The assists in effect now. The same object every call — read it, do not keep a field. */
export function getLiveAssists(): Readonly<AssistSettings> {
  return live;
}

/** Start of a run: the sticky bits restart from what is on right now. */
export function beginRunAssists(): void {
  runBits = assistBits(live);
  notify();
}

/** Every assist that was on at some point of the current run. 0 = unassisted. */
export function getRunAssistBits(): number {
  return runBits;
}

export function setHoldModes(next: Readonly<Record<'sprint' | 'brake' | 'paddle', HoldMode>>): void {
  holdModes.sprint = next.sprint;
  holdModes.brake = next.brake;
  holdModes.paddle = next.paddle;
}

export function getHoldModes(): Readonly<Record<'sprint' | 'brake' | 'paddle', HoldMode>> {
  return holdModes;
}

/** SettingsSync, once the mode's palette is loaded (`palettes.ts` is lazy). */
export function setColorVisionMode(mode: ColorVisionMode, next: Readonly<AccessPalette> = AUTHORED_PALETTE): void {
  if (mode === colorVision && next === palette) return;
  colorVision = mode;
  palette = next;
  notify();
}

/** The palette for the current colour-vision mode (in-world telegraphs read this). */
export function getAccessPalette(): Readonly<AccessPalette> {
  return palette;
}

export function setCaptionsEnabled(on: boolean): void {
  if (on === captions) return;
  captions = on;
  notify();
}

export function captionsEnabled(): boolean {
  return captions;
}

/** What turns a played sound into a caption; set by the lazy caption layer while it is up. */
export type SoundCaptioner = (name: string, listener: unknown, position?: { x: number; y: number; z: number } | null) => void;
let soundCaptioner: SoundCaptioner | null = null;

export function setSoundCaptioner(fn: SoundCaptioner | null): void {
  soundCaptioner = fn;
}

/** Null unless captions are up — the AudioManager's one read per sound. */
export function getSoundCaptioner(): SoundCaptioner | null {
  return soundCaptioner;
}

/** Any access value changed (palette, captions, assists). */
export function subscribeAccess(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests: back to a fresh page. */
export function resetAccessRuntimeForTests(): void {
  Object.assign(live, NO_ASSISTS);
  runBits = 0;
  colorVision = 'off';
  palette = AUTHORED_PALETTE;
  captions = false;
  holdModes.sprint = holdModes.brake = holdModes.paddle = 'hold';
  listeners.clear();
  soundCaptioner = null;
}
