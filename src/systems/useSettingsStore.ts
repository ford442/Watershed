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
 * - Persisted to localStorage under 'watershed-settings' (version 1).
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
  findConflict,
  type Binding,
  type Bindings,
  type SettingsAction,
  type SettingsQuality,
  type VolumeChannel,
} from './settingsDerive';

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
  bindings: Bindings;
  /** Flipped true once persisted state has rehydrated (or confirmed absent). */
  _hasHydrated: boolean;
}

export interface SettingsActions {
  setVolume: (channel: VolumeChannel, value: number) => void;
  setSensitivity: (value: number) => void;
  setInvertY: (value: boolean) => void;
  setQuality: (quality: SettingsQuality) => void;
  /**
   * Bind a physical input to an action. Performs conflict detection: if the
   * input is already bound to another action, the two are SWAPPED rather than
   * allowing a double-bound physical input. No-ops on an unchanged binding.
   */
  bindAction: (action: SettingsAction, binding: Binding) => void;
  unbindAction: (action: SettingsAction) => void;
  resetToDefaults: () => void;
  setHasHydrated: (value: boolean) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

export const DEFAULT_SETTINGS: SettingsState = {
  masterVolume: 1.0,
  musicVolume: 0.8,
  sfxVolume: 0.9,
  mouseSensitivity: 1.0,
  invertY: false,
  quality: 'high',
  bindings: { ...DEFAULT_BINDINGS },
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
  // default instead of being undefined.
  const mergedBindings: Bindings = { ...DEFAULT_BINDINGS };
  if (p.bindings && typeof p.bindings === 'object') {
    for (const action of Object.keys(DEFAULT_BINDINGS) as SettingsAction[]) {
      const candidate = (p.bindings as Partial<Bindings>)[action];
      if (
        candidate &&
        (candidate.kind === 'key' || candidate.kind === 'mouse') &&
        typeof candidate.code === 'string'
      ) {
        mergedBindings[action] = { kind: candidate.kind, code: candidate.code };
      }
    }
  }

  return {
    masterVolume:
      typeof p.masterVolume === 'number' ? clamp(p.masterVolume, 0, 1) : base.masterVolume,
    musicVolume:
      typeof p.musicVolume === 'number' ? clamp(p.musicVolume, 0, 1) : base.musicVolume,
    sfxVolume:
      typeof p.sfxVolume === 'number' ? clamp(p.sfxVolume, 0, 1) : base.sfxVolume,
    mouseSensitivity:
      typeof p.mouseSensitivity === 'number'
        ? clamp(p.mouseSensitivity, 0.1, 2.0)
        : base.mouseSensitivity,
    invertY: typeof p.invertY === 'boolean' ? p.invertY : base.invertY,
    quality:
      p.quality === 'low' || p.quality === 'med' || p.quality === 'high'
        ? p.quality
        : base.quality,
    bindings: mergedBindings,
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
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      bindings: { ...DEFAULT_BINDINGS },

      setVolume: (channel, value) =>
        set({ [VOLUME_KEY[channel]]: clamp(value, 0, 1) } as Partial<SettingsState>),

      setSensitivity: (value) => set({ mouseSensitivity: clamp(value, 0.1, 2.0) }),

      setInvertY: (value) => set({ invertY: value }),

      setQuality: (quality) => set({ quality }),

      bindAction: (action, binding) =>
        set((state) => {
          const current = state.bindings[action];
          if (
            current &&
            current.kind === binding.kind &&
            current.code === binding.code
          ) {
            return {}; // no-op — already bound here
          }
          const conflict = findConflict(state.bindings, binding, action);
          const next: Bindings = { ...state.bindings, [action]: { ...binding } };
          if (conflict) {
            // Swap: give the conflicting action this action's previous binding
            // so no physical input is ever double-bound.
            next[conflict] = { ...current };
          }
          return { bindings: next };
        }),

      unbindAction: (action) =>
        set((state) => ({
          bindings: { ...state.bindings, [action]: { ...DEFAULT_BINDINGS[action] } },
        })),

      resetToDefaults: () =>
        set({
          masterVolume: DEFAULT_SETTINGS.masterVolume,
          musicVolume: DEFAULT_SETTINGS.musicVolume,
          sfxVolume: DEFAULT_SETTINGS.sfxVolume,
          mouseSensitivity: DEFAULT_SETTINGS.mouseSensitivity,
          invertY: DEFAULT_SETTINGS.invertY,
          quality: DEFAULT_SETTINGS.quality,
          bindings: { ...DEFAULT_BINDINGS },
        }),

      setHasHydrated: (value) => set({ _hasHydrated: value }),
    }),
    {
      name: 'watershed-settings',
      version: 1,
      storage: createJSONStorage(() => createSafeStorage()),
      skipHydration: true,
      migrate: (persisted, version) => migrateSettings(persisted, version),
      // Custom merge so backfill-over-defaults runs on EVERY load, not only on a
      // version bump: the default shallow merge would let a same-version persisted
      // `bindings` object that predates a newly-added action leave that action
      // undefined. migrateSettings normalizes + backfills against DEFAULT_SETTINGS.
      merge: (persisted, current) => ({
        ...current,
        ...migrateSettings(persisted, 1),
      }),
      // Only persist the settings themselves, never the transient hydration flag.
      partialize: (state) => ({
        masterVolume: state.masterVolume,
        musicVolume: state.musicVolume,
        sfxVolume: state.sfxVolume,
        mouseSensitivity: state.mouseSensitivity,
        invertY: state.invertY,
        quality: state.quality,
        bindings: state.bindings,
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

export default useSettingsStore;
