/**
 * settingsDerive.ts — Pure helpers for the settings system.
 *
 * These functions are deliberately free of React, Zustand, and DOM state so
 * they can be unit-tested without a GL context (see settingsDerive.test.ts).
 *
 * Responsibilities:
 * - Canonical action list + default bindings.
 * - `bindingsToDreiMap` — derive the <KeyboardControls map> array from bindings.
 * - `qualityToEffects` — map a quality preset to which post effects are present.
 * - Conflict detection + reserved-input rules for rebinding.
 */

import type { QualityPreset } from './GameState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VolumeChannel = 'master' | 'music' | 'sfx';

/** Quality preset owned by the settings panel. Kept separate from the renderer's
 *  QualityLevel ('low'|'medium'|'high'|'ultra') and mapped via settingsQualityToLOD. */
export type SettingsQuality = 'low' | 'med' | 'high';

/**
 * A binding is NOT "a key" — right-click-forward is a mouse button. Always use
 * the physical `event.code` for keys (never `event.key`, which scrambles under
 * AZERTY/Dvorak), and a synthetic Mouse<button> code for mouse buttons.
 */
export type BindingKind = 'key' | 'mouse';
export interface Binding {
  kind: BindingKind;
  /** `event.code` for keys (e.g. 'KeyW'); 'Mouse0'|'Mouse1'|'Mouse2' for buttons. */
  code: string;
}

/** Rebindable actions — a subset that mirrors the drei KeyboardControls map. */
export type SettingsAction =
  | 'forward'
  | 'backward'
  | 'leftward'
  | 'rightward'
  | 'jump'
  | 'sprint'
  | 'brake'
  | 'dodge';

export const SETTINGS_ACTIONS: SettingsAction[] = [
  'forward',
  'backward',
  'leftward',
  'rightward',
  'jump',
  'sprint',
  'brake',
  'dodge',
];

export const ACTION_LABELS: Record<SettingsAction, string> = {
  forward: 'Forward',
  backward: 'Backward',
  leftward: 'Strafe Left',
  rightward: 'Strafe Right',
  jump: 'Jump',
  sprint: 'Sprint',
  brake: 'Brake / Slide',
  dodge: 'Dodge',
};

export type Bindings = Record<SettingsAction, Binding>;

// ---------------------------------------------------------------------------
// Defaults — mirror the historical hardcoded map in Experience.tsx.
// ---------------------------------------------------------------------------

export const DEFAULT_BINDINGS: Bindings = {
  forward: { kind: 'key', code: 'KeyW' },
  backward: { kind: 'key', code: 'KeyS' },
  leftward: { kind: 'key', code: 'KeyA' },
  rightward: { kind: 'key', code: 'KeyD' },
  jump: { kind: 'key', code: 'Space' },
  sprint: { kind: 'key', code: 'ShiftLeft' },
  brake: { kind: 'key', code: 'ControlLeft' },
  dodge: { kind: 'key', code: 'AltLeft' },
};

// ---------------------------------------------------------------------------
// Reserved inputs — can never be captured.
// ---------------------------------------------------------------------------

/**
 * Physical codes the browser owns or that the menu system needs. Capturing
 * these would either be swallowed by the browser or break menu/pointer-lock
 * handling.
 */
export const RESERVED_CODES: ReadonlySet<string> = new Set([
  'Escape',
  'Tab',
  'F5',
  'F11',
  'F12',
  'ContextMenu',
  'MetaLeft',
  'MetaRight',
]);

/**
 * True when a keyboard capture event must be rejected: a reserved code, or a
 * browser-owned modifier combo (Ctrl+W, Cmd+…) that we can't reliably intercept.
 */
export function isReservedKeyCapture(e: {
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  if (RESERVED_CODES.has(e.code)) return true;
  // Modifier keys pressed alone are fine as bindings (Shift/Ctrl/Alt sprint etc.),
  // but Ctrl/Cmd + another key is a browser-owned combo.
  const isModifierItself =
    e.code.startsWith('Control') ||
    e.code.startsWith('Shift') ||
    e.code.startsWith('Alt') ||
    e.code.startsWith('Meta');
  if ((e.ctrlKey || e.metaKey) && !isModifierItself) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

export function bindingsEqual(a: Binding, b: Binding): boolean {
  return a.kind === b.kind && a.code === b.code;
}

/**
 * Returns the action already bound to `binding` (other than `exclude`), or null.
 * Used by bindAction to reject/swap a double-bound physical input.
 */
export function findConflict(
  bindings: Bindings,
  binding: Binding,
  exclude?: SettingsAction
): SettingsAction | null {
  for (const action of SETTINGS_ACTIONS) {
    if (action === exclude) continue;
    if (bindingsEqual(bindings[action], binding)) return action;
  }
  return null;
}

// ---------------------------------------------------------------------------
// drei <KeyboardControls> map derivation
// ---------------------------------------------------------------------------

export interface DreiKeyMapEntry {
  name: string;
  keys: string[];
}

/**
 * Derive the drei KeyboardControls `map` from bindings. Only key-kind bindings
 * are included — mouse bindings are handled separately by usePlayerControls,
 * since drei's KeyboardControls only listens to the keyboard.
 *
 * Pure: changing the returned reference rebuilds drei's listeners with no custom
 * event system.
 */
export function bindingsToDreiMap(bindings: Bindings): DreiKeyMapEntry[] {
  const map: DreiKeyMapEntry[] = [];
  for (const action of SETTINGS_ACTIONS) {
    const b = bindings[action];
    if (b.kind === 'key') {
      map.push({ name: action, keys: [b.code] });
    }
  }
  return map;
}

/** Mouse-bound actions, as `{ action: 'Mouse2' }`. Consumed by usePlayerControls. */
export function bindingsToMouseMap(
  bindings: Bindings
): Partial<Record<SettingsAction, string>> {
  const out: Partial<Record<SettingsAction, string>> = {};
  for (const action of SETTINGS_ACTIONS) {
    const b = bindings[action];
    if (b.kind === 'mouse') out[action] = b.code;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quality → post-effect presence (pure, tested)
// ---------------------------------------------------------------------------

export interface EffectPresence {
  bloom: boolean;
  vignette: boolean;
  chromaticAberration: boolean;
  godRays: boolean;
  ssao: boolean;
}

/**
 * Which post-processing effects are present for a quality preset. Effect
 * *toggles* apply live; resolution/multisampling changes are deferred to reload.
 */
export function qualityToEffects(quality: SettingsQuality): EffectPresence {
  switch (quality) {
    case 'low':
      return {
        bloom: true,
        vignette: true,
        chromaticAberration: false,
        godRays: false,
        ssao: false,
      };
    case 'med':
      return {
        bloom: true,
        vignette: true,
        chromaticAberration: true,
        godRays: true,
        ssao: false,
      };
    case 'high':
    default:
      return {
        bloom: true,
        vignette: true,
        chromaticAberration: true,
        godRays: true,
        ssao: true,
      };
  }
}

/** Map the settings-panel quality onto the renderer's LOD QualityPreset. */
export function settingsQualityToLOD(quality: SettingsQuality): QualityPreset {
  switch (quality) {
    case 'low':
      return 'low';
    case 'med':
      return 'medium';
    case 'high':
    default:
      return 'high';
  }
}

/** Human labels for the quality buttons. */
export const QUALITY_LABELS: Record<SettingsQuality, string> = {
  low: 'Low',
  med: 'Medium',
  high: 'High',
};
