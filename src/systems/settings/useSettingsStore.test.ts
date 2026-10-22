import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useSettingsStore,
  DEFAULT_SETTINGS,
  migrateSettings,
  createSafeStorage,
} from './useSettingsStore';
import { DEFAULT_BINDINGS, DEFAULT_PAD_BINDINGS } from './settingsDerive';

const reset = () =>
  useSettingsStore.setState({
    masterVolume: DEFAULT_SETTINGS.masterVolume,
    musicVolume: DEFAULT_SETTINGS.musicVolume,
    sfxVolume: DEFAULT_SETTINGS.sfxVolume,
    mouseSensitivity: DEFAULT_SETTINGS.mouseSensitivity,
    invertY: DEFAULT_SETTINGS.invertY,
    quality: DEFAULT_SETTINGS.quality,
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
    _hasHydrated: false,
  });

beforeEach(reset);

describe('defaults', () => {
  it('start at documented values', () => {
    const s = useSettingsStore.getState();
    expect(s.masterVolume).toBe(1.0);
    expect(s.musicVolume).toBe(0.8);
    expect(s.sfxVolume).toBe(0.9);
    expect(s.mouseSensitivity).toBe(1.0);
    expect(s.invertY).toBe(false);
    expect(s.quality).toBe('high');
    expect(s.bindings.forward).toEqual({ kind: 'key', code: 'KeyW' });
  });
});

describe('setters', () => {
  it('setVolume clamps per channel', () => {
    useSettingsStore.getState().setVolume('music', 0.3);
    expect(useSettingsStore.getState().musicVolume).toBe(0.3);
    useSettingsStore.getState().setVolume('master', 5);
    expect(useSettingsStore.getState().masterVolume).toBe(1);
    useSettingsStore.getState().setVolume('sfx', -1);
    expect(useSettingsStore.getState().sfxVolume).toBe(0);
  });

  it('setSensitivity clamps to [0.1, 2.0]', () => {
    useSettingsStore.getState().setSensitivity(10);
    expect(useSettingsStore.getState().mouseSensitivity).toBe(2.0);
    useSettingsStore.getState().setSensitivity(0);
    expect(useSettingsStore.getState().mouseSensitivity).toBe(0.1);
  });

  it('setInvertY and setQuality mutate', () => {
    useSettingsStore.getState().setInvertY(true);
    expect(useSettingsStore.getState().invertY).toBe(true);
    useSettingsStore.getState().setQuality('low');
    expect(useSettingsStore.getState().quality).toBe('low');
  });
});

describe('bindAction conflict handling', () => {
  it('rebinds a free input', () => {
    useSettingsStore.getState().bindAction('jump', { kind: 'key', code: 'KeyJ' });
    expect(useSettingsStore.getState().bindings.jump).toEqual({ kind: 'key', code: 'KeyJ' });
  });

  it('swaps rather than double-binds a conflicting input', () => {
    // Bind forward to backward's key (KeyS) → they swap.
    useSettingsStore.getState().bindAction('forward', { kind: 'key', code: 'KeyS' });
    const b = useSettingsStore.getState().bindings;
    expect(b.forward).toEqual({ kind: 'key', code: 'KeyS' });
    expect(b.backward).toEqual({ kind: 'key', code: 'KeyW' }); // got forward's old key
  });

  it('accepts a mouse binding for forward', () => {
    useSettingsStore.getState().bindAction('forward', { kind: 'mouse', code: 'Mouse2' });
    expect(useSettingsStore.getState().bindings.forward).toEqual({ kind: 'mouse', code: 'Mouse2' });
  });

  it('unbindAction restores the default', () => {
    useSettingsStore.getState().bindAction('jump', { kind: 'key', code: 'KeyJ' });
    useSettingsStore.getState().unbindAction('jump');
    expect(useSettingsStore.getState().bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
  });
});

describe('resetToDefaults', () => {
  it('restores every setting', () => {
    const s = useSettingsStore.getState();
    s.setVolume('master', 0.2);
    s.setSensitivity(1.7);
    s.setInvertY(true);
    s.setQuality('low');
    s.bindAction('jump', { kind: 'key', code: 'KeyJ' });
    useSettingsStore.getState().resetToDefaults();
    const after = useSettingsStore.getState();
    expect(after.masterVolume).toBe(1.0);
    expect(after.mouseSensitivity).toBe(1.0);
    expect(after.invertY).toBe(false);
    expect(after.quality).toBe('high');
    expect(after.bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
  });
});

describe('migrateSettings — merge over defaults', () => {
  it('backfills a missing action from defaults', () => {
    const partial = {
      masterVolume: 0.5,
      bindings: { forward: { kind: 'key', code: 'KeyI' } }, // only one action present
    };
    const migrated = migrateSettings(partial, 0);
    expect(migrated.masterVolume).toBe(0.5);
    expect(migrated.bindings.forward).toEqual({ kind: 'key', code: 'KeyI' });
    // Missing actions backfilled:
    expect(migrated.bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
    expect(migrated.bindings.backward).toEqual(DEFAULT_BINDINGS.backward);
  });

  it('falls back entirely for corrupt/absent data', () => {
    expect(migrateSettings(null, 0).quality).toBe('high');
    expect(migrateSettings('garbage', 0).bindings.forward).toEqual(DEFAULT_BINDINGS.forward);
  });

  it('clamps out-of-range persisted numbers', () => {
    const migrated = migrateSettings({ masterVolume: 9, mouseSensitivity: 99 }, 0);
    expect(migrated.masterVolume).toBe(1);
    expect(migrated.mouseSensitivity).toBe(2.0);
  });
});

describe('rehydration merge — backfills missing actions on same-version data', () => {
  it('a persisted v1 blob missing an action is backfilled after rehydrate', async () => {
    const { rehydrateSettings } = await import('./useSettingsStore');
    // Simulate a same-version (1) persisted blob that predates the `dodge` action.
    const blob = {
      state: {
        masterVolume: 0.4,
        bindings: {
          forward: { kind: 'key', code: 'KeyI' },
          // no `dodge` — must be backfilled from defaults, not left undefined
        },
      },
      version: 1,
    };
    window.localStorage.setItem('watershed-settings', JSON.stringify(blob));
    rehydrateSettings();
    await Promise.resolve();
    const s = useSettingsStore.getState();
    expect(s.masterVolume).toBe(0.4);
    expect(s.bindings.forward).toEqual({ kind: 'key', code: 'KeyI' });
    expect(s.bindings.dodge).toEqual(DEFAULT_BINDINGS.dodge);
    expect(s._hasHydrated).toBe(true);
    window.localStorage.removeItem('watershed-settings');
  });
});

describe('createSafeStorage — degrades to memory on throwing setItem', () => {
  it('does not throw when the backend rejects setItem, and reads back from memory', () => {
    const throwingSetItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    const storage = createSafeStorage();
    expect(() => storage.setItem('k', 'v')).not.toThrow();
    // Value is retrievable from the in-memory fallback even though the backend failed.
    expect(storage.getItem('k')).toBe('v');
    throwingSetItem.mockRestore();
  });
});

describe('v2 comfort / haptics / gamepad / touch fields (#486 D)', () => {
  it('start at documented values', () => {
    const s = useSettingsStore.getState();
    expect(s.fov).toBe(75);
    expect(s.fovKick).toBe(1);
    expect(s.cameraShake).toBe(1);
    expect(s.speedEffects).toBe(true);
    expect(s.vignetteStrength).toBe(1);
    expect(s.reducedMotion).toBe('system');
    expect(s.leftHanded).toBe(false);
    expect(s.hapticsEnabled).toBe(true);
    expect(s.hapticsStrength).toBe(1);
    expect(s.gamepadDeadzone).toBe(0.15);
    expect(s.gamepadCurve).toBe(1);
    expect(s.padBindings).toEqual(DEFAULT_PAD_BINDINGS);
  });

  it('setters clamp to their ranges', () => {
    const st = useSettingsStore.getState();
    st.setFov(10);
    expect(useSettingsStore.getState().fov).toBe(70);
    st.setFov(999);
    expect(useSettingsStore.getState().fov).toBe(110);
    st.setCameraShake(-1);
    expect(useSettingsStore.getState().cameraShake).toBe(0);
    st.setGamepadDeadzone(9);
    expect(useSettingsStore.getState().gamepadDeadzone).toBe(0.5);
    st.setGamepadCurve(0);
    expect(useSettingsStore.getState().gamepadCurve).toBe(1);
    st.setHapticsStrength(5);
    expect(useSettingsStore.getState().hapticsStrength).toBe(1);
  });

  it('a gamepad bind goes in its own table and leaves the keyboard binding alone', () => {
    useSettingsStore.getState().bindAction('jump', { kind: 'gamepad-button', code: 'Button1' });
    const s = useSettingsStore.getState();
    expect(s.padBindings.jump).toEqual({ kind: 'gamepad-button', code: 'Button1' });
    expect(s.bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
  });

  it('a pad bind onto a taken button swaps, so no pad input is double-bound', () => {
    // Jump is A (Button0), Dodge is X (Button2): put Jump on X.
    useSettingsStore.getState().bindAction('jump', { kind: 'gamepad-button', code: 'Button2' });
    const s = useSettingsStore.getState();
    expect(s.padBindings.jump.code).toBe('Button2');
    expect(s.padBindings.dodge.code).toBe('Button0');
  });

  it('unbindPadAction restores the default pad binding', () => {
    useSettingsStore.getState().bindAction('jump', { kind: 'gamepad-button', code: 'Button1' });
    useSettingsStore.getState().unbindPadAction('jump');
    expect(useSettingsStore.getState().padBindings.jump).toEqual(DEFAULT_PAD_BINDINGS.jump);
  });
});

describe('migration v1 → v2', () => {
  it('a v1 blob (no comfort fields, no pad table) migrates to defaults and keeps what it had', () => {
    const v1 = {
      masterVolume: 0.5,
      mouseSensitivity: 1.5,
      invertY: true,
      quality: 'low',
      bindings: { forward: { kind: 'key', code: 'KeyI' } },
    };
    const m = migrateSettings(v1, 1);
    expect(m.masterVolume).toBe(0.5);
    expect(m.invertY).toBe(true);
    expect(m.quality).toBe('low');
    expect(m.bindings.forward).toEqual({ kind: 'key', code: 'KeyI' });
    expect(m.fov).toBe(75);
    expect(m.reducedMotion).toBe('system');
    expect(m.hapticsEnabled).toBe(true);
    expect(m.padBindings).toEqual(DEFAULT_PAD_BINDINGS);
  });

  it('keeps persisted comfort values, clamps bad ones, and ignores junk types', () => {
    const m = migrateSettings(
      { fov: 120, fovKick: 0.5, cameraShake: 'lots', speedEffects: false, reducedMotion: 'on', leftHanded: true, gamepadCurve: 2.5, hapticsEnabled: 'yes' },
      2,
    );
    expect(m.fov).toBe(110);
    expect(m.fovKick).toBe(0.5);
    expect(m.cameraShake).toBe(1);
    expect(m.speedEffects).toBe(false);
    expect(m.reducedMotion).toBe('on');
    expect(m.leftHanded).toBe(true);
    expect(m.gamepadCurve).toBe(2.5);
    expect(m.hapticsEnabled).toBe(true);
  });

  it('the keyboard table never holds a gamepad kind and the pad table never a key', () => {
    const m = migrateSettings(
      {
        bindings: { jump: { kind: 'gamepad-button', code: 'Button0' } },
        padBindings: { jump: { kind: 'key', code: 'KeyZ' }, dodge: { kind: 'gamepad-button', code: 'Button7' } },
      },
      2,
    );
    expect(m.bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
    expect(m.padBindings.jump).toEqual(DEFAULT_PAD_BINDINGS.jump);
    expect(m.padBindings.dodge).toEqual({ kind: 'gamepad-button', code: 'Button7' });
  });

  it('persists under the same key with the version bumped and rehydrates a v1 blob', async () => {
    const { rehydrateSettings, SETTINGS_VERSION } = await import('./useSettingsStore');
    expect(SETTINGS_VERSION).toBe(2);
    window.localStorage.setItem(
      'watershed-settings',
      JSON.stringify({ state: { masterVolume: 0.2, quality: 'med' }, version: 1 }),
    );
    rehydrateSettings();
    await Promise.resolve();
    const s = useSettingsStore.getState();
    expect(s.masterVolume).toBe(0.2);
    expect(s.quality).toBe('med');
    expect(s.fov).toBe(75);
    window.localStorage.removeItem('watershed-settings');
  });

  it('persists the new fields (partialize) without the hydration flag', () => {
    useSettingsStore.getState().setFov(95);
    useSettingsStore.getState().setLeftHanded(true);
    const raw = window.localStorage.getItem('watershed-settings');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.version).toBe(2);
    expect(parsed.state.fov).toBe(95);
    expect(parsed.state.leftHanded).toBe(true);
    expect(parsed.state._hasHydrated).toBeUndefined();
    window.localStorage.removeItem('watershed-settings');
  });
});
