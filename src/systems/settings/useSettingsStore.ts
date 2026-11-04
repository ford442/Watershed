/**
 * useSettingsStore.ts — Dedicated, persisted player-settings store.
 *
 * WHY A SEPARATE STORE (settled decision, see the issue):
 * - Isolates settings churn from GameState (which holds per-frame data like
 *   speed/score) so a volume-slider drag can't re-render gameplay subscribers.
 * - Matches the Zustand store pattern the codebase already runs.
 * - All genuine complexity (conflict detection, migration, transient reads)
 *   lives in the store *actions*, not in structure.
 *
 * PERSISTENCE:
 * - Persisted to localStorage under 'watershed-settings' (version 2 — #486 D added
 *   comfort / haptics / gamepad / touch; a v1 file migrates by backfilling defaults).
 * - migrate() MERGES persisted state OVER DEFAULT_SETTINGS so a newly-added
 *   action/setting is backfilled instead of dropped.
 * - skipHydration + an explicit rehydrate() at app root, with a `_hasHydrated`
 *   flag, kills the flash-of-defaults / SSR-style hydration mismatch.
 * - The storage is wrapped so a throwing setItem (private mode / quota) degrades
 *   to in-memory instead of crashing boot.
 */

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import {
  DEFAULT_BINDINGS,
  DEFAULT_PAD_BINDINGS,
  findConflict,
  isGamepadBinding,
  type Binding,
  type Bindings,
  type SettingsAction,
  type SettingsQuality,
  type VolumeChannel,
} from './settingsDerive';
import type { PhysicsWorkerPreference } from '../../utils/physicsWorkerFlag';
import { FOV_DEFAULT, FOV_MAX, FOV_MIN, type ReducedMotionPref } from './comfort';

/** Persisted shape version. v2 (#486 D) adds the comfort / haptics / gamepad / touch fields. */
export const SETTINGS_VERSION = 2;
import { clamp } from '../../math/scalar';

// ---------------------------------------------------------------------------
// State + actions
// ---------------------------------------------------------------------------

export interface SettingsState {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  /** Mouse-look multiplier, 0.1–2.0. */
  mouseSensitivity: number;
  invertY: boolean;
  quality: SettingsQuality;
  /**
   * Physics-worker preference. 'auto' means "on wherever the browser supports
   * Worker + WebAssembly" — see resolvePhysicsWorker. 'off' is the in-game kill
   * switch that mirrors `?physicsWorker=0`.
   */
  physicsWorker: PhysicsWorkerPreference;
  bindings: Bindings;
  /** Gamepad table (`gamepad-button` / `gamepad-axis` kinds only). */
  padBindings: Bindings;

  // --- Comfort (#486 D) ---
  /** Base vertical FOV in degrees, 70–110. */
  fov: number;
  /** Speed / waterfall FOV kick as a fraction of the authored kick, 0–1. */
  fovKick: number;
  /** Camera shake amplitude, 0–1. */
  cameraShake: number;
  /** Speed blur / chromatic aberration. */
  speedEffects: boolean;
  /** Vignette darkness as a fraction of the authored value, 0–1. */
  vignetteStrength: number;
  /** 'system' follows the OS `prefers-reduced-motion` flag. */
  reducedMotion: ReducedMotionPref;

  // --- Touch ---
  /** Mirror the touch layout: stick on the right, look on the left. */
  leftHanded: boolean;

  // --- Haptics ---
  hapticsEnabled: boolean;
  /** 0–1 multiplier on every rumble magnitude. */
  hapticsStrength: number;

  // --- Gamepad ---
  /** Radial dead zone, 0–0.5. */
  gamepadDeadzone: number;
  /** Response curve exponent: 1 = linear, 2 = quadratic. 1–3. */
  gamepadCurve: number;

  /** Flipped true once persisted state has rehydrated (or confirmed absent). */
  _hasHydrated: boolean;
}

export interface SettingsActions {
  setVolume: (channel: VolumeChannel, value: number) => void;
  setSensitivity: (value: number) => void;
  setInvertY: (value: boolean) => void;
  setQuality: (quality: SettingsQuality) => void;
  setPhysicsWorker: (preference: PhysicsWorkerPreference) => void;
  /**
   * Bind a physical input to an action. Performs conflict detection: if the
   * input is already bound to another action, the two are SWAPPED rather than
   * allowing a double-bound physical input. No-ops on an unchanged binding.
   */
  bindAction: (action: SettingsAction, binding: Binding) => void;
  unbindAction: (action: SettingsAction) => void;
  /** Reset one action's gamepad binding to its default. */
  unbindPadAction: (action: SettingsAction) => void;
  setFov: (value: number) => void;
  setFovKick: (value: number) => void;
  setCameraShake: (value: number) => void;
  setSpeedEffects: (value: boolean) => void;
  setVignetteStrength: (value: number) => void;
  setReducedMotion: (value: ReducedMotionPref) => void;
  setLeftHanded: (value: boolean) => void;
  setHapticsEnabled: (value: boolean) => void;
  setHapticsStrength: (value: number) => void;
  setGamepadDeadzone: (value: number) => void;
  setGamepadCurve: (value: number) => void;
  resetToDefaults: () => void;
  setHasHydrated: (value: boolean) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

/** A non-finite stored value reads as the floor, never NaN. */
const clampSetting = (v: number, lo: number, hi: number) => clamp(Number.isFinite(v) ? v : lo, lo, hi);

/** A persisted number clamped to [lo, hi], or the default when absent / not a number. */
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;

export const DEFAULT_SETTINGS: SettingsState = {
  masterVolume: 1.0,
  musicVolume: 0.8,
  sfxVolume: 0.9,
  mouseSensitivity: 1.0,
  invertY: false,
  quality: 'high',
  physicsWorker: 'auto',
  bindings: { ...DEFAULT_BINDINGS },
  padBindings: { ...DEFAULT_PAD_BINDINGS },
  fov: FOV_DEFAULT,
  fovKick: 1,
  cameraShake: 1,
  speedEffects: true,
  vignetteStrength: 1,
  reducedMotion: 'system',
  leftHanded: false,
  hapticsEnabled: true,
  hapticsStrength: 1,
  gamepadDeadzone: 0.15,
  gamepadCurve: 1,
  _hasHydrated: false,
};

// ---------------------------------------------------------------------------
// Storage wrapper — degrade to in-memory on a throwing setItem.
// ---------------------------------------------------------------------------

export function createSafeStorage(): StateStorage {
  const memory = new Map<string, string>();
  let backendUsable = true;

  const backend = (): Storage | null => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  return {
    getItem: (name) => {
      if (backendUsable) {
        try {
          const ls = backend();
          if (ls) {
            const v = ls.getItem(name);
            if (v !== null) return v;
          }
        } catch {
          backendUsable = false;
        }
      }
      return memory.has(name) ? memory.get(name)! : null;
    },
    setItem: (name, value) => {
      // Always keep an in-memory copy so reads work even if the backend fails.
      memory.set(name, value);
      if (!backendUsable) return;
      try {
        const ls = backend();
        ls?.setItem(name, value);
      } catch {
        // Private mode / quota exceeded — stop touching the backend, keep memory.
        backendUsable = false;
      }
    },
    removeItem: (name) => {
      memory.delete(name);
      if (!backendUsable) return;
      try {
        backend()?.removeItem(name);
      } catch {
        backendUsable = false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Migration — merge persisted OVER defaults so missing keys are backfilled.
// ---------------------------------------------------------------------------

function mergeBindingTable(persisted: unknown, defaults: Bindings, gamepad: boolean): Bindings {
  const merged: Bindings = { ...defaults };
  if (!persisted || typeof persisted !== 'object') return merged;
  for (const action of Object.keys(defaults) as SettingsAction[]) {
    const candidate = (persisted as Partial<Bindings>)[action];
    if (!candidate || typeof candidate.code !== 'string') continue;
    const kindOk = gamepad
      ? candidate.kind === 'gamepad-button' || candidate.kind === 'gamepad-axis'
      : candidate.kind === 'key' || candidate.kind === 'mouse';
    if (kindOk) merged[action] = { kind: candidate.kind, code: candidate.code };
  }
  return merged;
}

export function migrateSettings(
  persisted: unknown,
  _version: number
): SettingsState {
  const base: SettingsState = {
    ...DEFAULT_SETTINGS,
    bindings: { ...DEFAULT_BINDINGS },
  };
  if (!persisted || typeof persisted !== 'object') return base;

  const p = persisted as Partial<SettingsState>;

  // Merge bindings action-by-action so a newly-added action falls back to its
  // default instead of being undefined. The keyboard table only ever holds
  // key / mouse kinds, the gamepad table only gamepad kinds — a v1 file has no
  // pad table at all, and a hand-edited one cannot cross the streams.
  const mergedBindings = mergeBindingTable(p.bindings, DEFAULT_BINDINGS, false);
  const mergedPadBindings = mergeBindingTable(p.padBindings, DEFAULT_PAD_BINDINGS, true);

  return {
    masterVolume:
      typeof p.masterVolume === 'number' ? clampSetting(p.masterVolume, 0, 1) : base.masterVolume,
    musicVolume:
      typeof p.musicVolume === 'number' ? clampSetting(p.musicVolume, 0, 1) : base.musicVolume,
    sfxVolume:
      typeof p.sfxVolume === 'number' ? clampSetting(p.sfxVolume, 0, 1) : base.sfxVolume,
    mouseSensitivity:
      typeof p.mouseSensitivity === 'number'
        ? clampSetting(p.mouseSensitivity, 0.1, 2.0)
        : base.mouseSensitivity,
    invertY: typeof p.invertY === 'boolean' ? p.invertY : base.invertY,
    quality:
      p.quality === 'low' || p.quality === 'med' || p.quality === 'high'
        ? p.quality
        : base.quality,
    physicsWorker:
      p.physicsWorker === 'auto' || p.physicsWorker === 'on' || p.physicsWorker === 'off'
        ? p.physicsWorker
        : base.physicsWorker,
    bindings: mergedBindings,
    padBindings: mergedPadBindings,
    fov: num(p.fov, FOV_MIN, FOV_MAX, base.fov),
    fovKick: num(p.fovKick, 0, 1, base.fovKick),
    cameraShake: num(p.cameraShake, 0, 1, base.cameraShake),
    speedEffects: typeof p.speedEffects === 'boolean' ? p.speedEffects : base.speedEffects,
    vignetteStrength: num(p.vignetteStrength, 0, 1, base.vignetteStrength),
    reducedMotion:
      p.reducedMotion === 'system' || p.reducedMotion === 'on' || p.reducedMotion === 'off'
        ? p.reducedMotion
        : base.reducedMotion,
    leftHanded: typeof p.leftHanded === 'boolean' ? p.leftHanded : base.leftHanded,
    hapticsEnabled: typeof p.hapticsEnabled === 'boolean' ? p.hapticsEnabled : base.hapticsEnabled,
    hapticsStrength: num(p.hapticsStrength, 0, 1, base.hapticsStrength),
    gamepadDeadzone: num(p.gamepadDeadzone, 0, 0.5, base.gamepadDeadzone),
    gamepadCurve: num(p.gamepadCurve, 1, 3, base.gamepadCurve),
    // Never trust a persisted hydration flag.
    _hasHydrated: false,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const VOLUME_KEY: Record<VolumeChannel, keyof SettingsState> = {
  master: 'masterVolume',
  music: 'musicVolume',
  sfx: 'sfxVolume',
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      bindings: { ...DEFAULT_BINDINGS },
      padBindings: { ...DEFAULT_PAD_BINDINGS },

      setVolume: (channel, value) =>
        set({ [VOLUME_KEY[channel]]: clampSetting(value, 0, 1) } as Partial<SettingsState>),

      setSensitivity: (value) => set({ mouseSensitivity: clampSetting(value, 0.1, 2.0) }),

      setInvertY: (value) => set({ invertY: value }),

      setQuality: (quality) => set({ quality }),

      setPhysicsWorker: (preference) => set({ physicsWorker: preference }),

      bindAction: (action, binding) =>
        set((state) => {
          // A gamepad input lives in its own table: binding A to Jump must not
          // evict the player's keyboard Jump.
          const pad = isGamepadBinding(binding);
          const table = pad ? state.padBindings : state.bindings;
          const current = table[action];
          if (
            current &&
            current.kind === binding.kind &&
            current.code === binding.code
          ) {
            return {}; // no-op — already bound here
          }
          const conflict = findConflict(table, binding, action);
          const next: Bindings = { ...table, [action]: { ...binding } };
          if (conflict) {
            // Swap: give the conflicting action this action's previous binding
            // so no physical input is ever double-bound.
            next[conflict] = { ...current };
          }
          return pad ? { padBindings: next } : { bindings: next };
        }),

      unbindAction: (action) =>
        set((state) => ({
          bindings: { ...state.bindings, [action]: { ...DEFAULT_BINDINGS[action] } },
        })),

      unbindPadAction: (action) =>
        set((state) => ({
          padBindings: { ...state.padBindings, [action]: { ...DEFAULT_PAD_BINDINGS[action] } },
        })),

      setFov: (value) => set({ fov: clamp(value, FOV_MIN, FOV_MAX) }),
      setFovKick: (value) => set({ fovKick: clamp(value, 0, 1) }),
      setCameraShake: (value) => set({ cameraShake: clamp(value, 0, 1) }),
      setSpeedEffects: (value) => set({ speedEffects: value }),
      setVignetteStrength: (value) => set({ vignetteStrength: clamp(value, 0, 1) }),
      setReducedMotion: (value) => set({ reducedMotion: value }),
      setLeftHanded: (value) => set({ leftHanded: value }),
      setHapticsEnabled: (value) => set({ hapticsEnabled: value }),
      setHapticsStrength: (value) => set({ hapticsStrength: clamp(value, 0, 1) }),
      setGamepadDeadzone: (value) => set({ gamepadDeadzone: clamp(value, 0, 0.5) }),
      setGamepadCurve: (value) => set({ gamepadCurve: clamp(value, 1, 3) }),

      resetToDefaults: () =>
        set({
          masterVolume: DEFAULT_SETTINGS.masterVolume,
          musicVolume: DEFAULT_SETTINGS.musicVolume,
          sfxVolume: DEFAULT_SETTINGS.sfxVolume,
          mouseSensitivity: DEFAULT_SETTINGS.mouseSensitivity,
          invertY: DEFAULT_SETTINGS.invertY,
          quality: DEFAULT_SETTINGS.quality,
          physicsWorker: DEFAULT_SETTINGS.physicsWorker,
          bindings: { ...DEFAULT_BINDINGS },
          padBindings: { ...DEFAULT_PAD_BINDINGS },
          fov: DEFAULT_SETTINGS.fov,
          fovKick: DEFAULT_SETTINGS.fovKick,
          cameraShake: DEFAULT_SETTINGS.cameraShake,
          speedEffects: DEFAULT_SETTINGS.speedEffects,
          vignetteStrength: DEFAULT_SETTINGS.vignetteStrength,
          reducedMotion: DEFAULT_SETTINGS.reducedMotion,
          leftHanded: DEFAULT_SETTINGS.leftHanded,
          hapticsEnabled: DEFAULT_SETTINGS.hapticsEnabled,
          hapticsStrength: DEFAULT_SETTINGS.hapticsStrength,
          gamepadDeadzone: DEFAULT_SETTINGS.gamepadDeadzone,
          gamepadCurve: DEFAULT_SETTINGS.gamepadCurve,
        }),

      setHasHydrated: (value) => set({ _hasHydrated: value }),
    }),
    {
      name: 'watershed-settings',
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => createSafeStorage()),
      skipHydration: true,
      migrate: (persisted, version) => migrateSettings(persisted, version),
      // Custom merge so backfill-over-defaults runs on EVERY load, not only on a
      // version bump: the default shallow merge would let a same-version persisted
      // `bindings` object that predates a newly-added action leave that action
      // undefined. migrateSettings normalizes + backfills against DEFAULT_SETTINGS.
      merge: (persisted, current) => ({
        ...current,
        ...migrateSettings(persisted, SETTINGS_VERSION),
      }),
      // Only persist the settings themselves, never the transient hydration flag.
      partialize: (state) => ({
        masterVolume: state.masterVolume,
        musicVolume: state.musicVolume,
        sfxVolume: state.sfxVolume,
        mouseSensitivity: state.mouseSensitivity,
        invertY: state.invertY,
        quality: state.quality,
        physicsWorker: state.physicsWorker,
        bindings: state.bindings,
        padBindings: state.padBindings,
        fov: state.fov,
        fovKick: state.fovKick,
        cameraShake: state.cameraShake,
        speedEffects: state.speedEffects,
        vignetteStrength: state.vignetteStrength,
        reducedMotion: state.reducedMotion,
        leftHanded: state.leftHanded,
        hapticsEnabled: state.hapticsEnabled,
        hapticsStrength: state.hapticsStrength,
        gamepadDeadzone: state.gamepadDeadzone,
        gamepadCurve: state.gamepadCurve,
      }),
      onRehydrateStorage: () => (state) => {
        // Runs after rehydrate() resolves (success or failure).
        state?.setHasHydrated(true);
        useSettingsStore.setState({ _hasHydrated: true });
      },
    }
  )
);

/**
 * Rehydrate persisted settings. Call once in a client-only effect at app root.
 * Safe to call more than once. Flips `_hasHydrated` via onRehydrateStorage.
 */
export function rehydrateSettings(): void {
  const result = useSettingsStore.persist?.rehydrate?.();
  // If rehydrate returned a promise, mark hydrated on settle as a belt-and-braces
  // guard (older zustand may skip onRehydrateStorage when there is nothing stored).
  if (result && typeof (result as Promise<unknown>).then === 'function') {
    (result as Promise<unknown>).then(
      () => useSettingsStore.getState().setHasHydrated(true),
      () => useSettingsStore.getState().setHasHydrated(true)
    );
  } else {
    useSettingsStore.getState().setHasHydrated(true);
  }
}
