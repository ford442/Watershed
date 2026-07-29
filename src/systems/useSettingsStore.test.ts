import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useSettingsStore,
  DEFAULT_SETTINGS,
  migrateSettings,
  createSafeStorage,
} from './useSettingsStore';
import { DEFAULT_BINDINGS } from './settingsDerive';

const reset = () =>
  useSettingsStore.setState({
    masterVolume: DEFAULT_SETTINGS.masterVolume,
    musicVolume: DEFAULT_SETTINGS.musicVolume,
    sfxVolume: DEFAULT_SETTINGS.sfxVolume,
    mouseSensitivity: DEFAULT_SETTINGS.mouseSensitivity,
    invertY: DEFAULT_SETTINGS.invertY,
    quality: DEFAULT_SETTINGS.quality,
    bindings: { ...DEFAULT_BINDINGS },
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
