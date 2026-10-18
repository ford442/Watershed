import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BINDINGS,
  bindingsToDreiMap,
  bindingsToMouseMap,
  findConflict,
  isReservedKeyCapture,
  qualityToEffects,
  settingsQualityToLOD,
  SETTINGS_ACTIONS,
  type Bindings,
} from './settingsDerive';

describe('bindingsToDreiMap', () => {
  it('derives one drei entry per key-bound action, using event.code', () => {
    const map = bindingsToDreiMap(DEFAULT_BINDINGS);
    expect(map).toContainEqual({ name: 'forward', keys: ['KeyW', 'ArrowUp'] });
    expect(map).toContainEqual({ name: 'jump', keys: ['Space'] });
    expect(map).toHaveLength(SETTINGS_ACTIONS.length);
  });

  it('adds the arrow keys as alternates for the four movement actions only', () => {
    const map = bindingsToDreiMap(DEFAULT_BINDINGS);
    expect(map.find((e) => e.name === 'backward')?.keys).toEqual(['KeyS', 'ArrowDown']);
    expect(map.find((e) => e.name === 'leftward')?.keys).toEqual(['KeyA', 'ArrowLeft']);
    expect(map.find((e) => e.name === 'rightward')?.keys).toEqual(['KeyD', 'ArrowRight']);
    expect(map.find((e) => e.name === 'sprint')?.keys).toEqual(['ShiftLeft']);
  });

  it('leaves an arrow alone when the player bound it to another action', () => {
    const bindings: Bindings = { ...DEFAULT_BINDINGS, jump: { kind: 'key', code: 'ArrowUp' } };
    const map = bindingsToDreiMap(bindings);
    expect(map.find((e) => e.name === 'forward')?.keys).toEqual(['KeyW']);
    expect(map.find((e) => e.name === 'jump')?.keys).toEqual(['ArrowUp']);
  });

  it('excludes mouse-bound actions from the drei map', () => {
    const bindings: Bindings = {
      ...DEFAULT_BINDINGS,
      forward: { kind: 'mouse', code: 'Mouse2' },
    };
    const map = bindingsToDreiMap(bindings);
    expect(map.find((e) => e.name === 'forward')).toBeUndefined();
    expect(map).toHaveLength(SETTINGS_ACTIONS.length - 1);
  });

  it('reflects a rebound key', () => {
    const bindings: Bindings = {
      ...DEFAULT_BINDINGS,
      jump: { kind: 'key', code: 'KeyJ' },
    };
    expect(bindingsToDreiMap(bindings)).toContainEqual({ name: 'jump', keys: ['KeyJ'] });
  });
});

describe('bindingsToMouseMap', () => {
  it('captures right-click-forward as a mouse binding', () => {
    const bindings: Bindings = {
      ...DEFAULT_BINDINGS,
      forward: { kind: 'mouse', code: 'Mouse2' },
    };
    expect(bindingsToMouseMap(bindings)).toEqual({ forward: 'Mouse2' });
  });

  it('is empty when there are no mouse bindings', () => {
    expect(bindingsToMouseMap(DEFAULT_BINDINGS)).toEqual({});
  });
});

describe('findConflict', () => {
  it('detects a double-bound physical input', () => {
    expect(findConflict(DEFAULT_BINDINGS, { kind: 'key', code: 'KeyS' })).toBe('backward');
  });

  it('ignores the excluded action', () => {
    expect(
      findConflict(DEFAULT_BINDINGS, { kind: 'key', code: 'KeyW' }, 'forward')
    ).toBeNull();
  });

  it('returns null when free', () => {
    expect(findConflict(DEFAULT_BINDINGS, { kind: 'key', code: 'KeyZ' })).toBeNull();
  });
});

describe('isReservedKeyCapture', () => {
  it('rejects Escape and function keys', () => {
    expect(isReservedKeyCapture({ code: 'Escape' })).toBe(true);
    expect(isReservedKeyCapture({ code: 'F5' })).toBe(true);
  });

  it('rejects Ctrl/Cmd combos', () => {
    expect(isReservedKeyCapture({ code: 'KeyW', ctrlKey: true })).toBe(true);
    expect(isReservedKeyCapture({ code: 'KeyT', metaKey: true })).toBe(true);
  });

  it('allows a bare modifier key as a binding', () => {
    expect(isReservedKeyCapture({ code: 'ShiftLeft' })).toBe(false);
    expect(isReservedKeyCapture({ code: 'ControlLeft', ctrlKey: true })).toBe(false);
  });

  it('allows normal keys', () => {
    expect(isReservedKeyCapture({ code: 'KeyW' })).toBe(false);
  });
});

describe('qualityToEffects', () => {
  it('low strips the expensive effects', () => {
    expect(qualityToEffects('low')).toMatchObject({
      chromaticAberration: false,
      godRays: false,
      ssao: false,
      bloom: true,
      vignette: true,
    });
  });

  it('med enables chromatic + god rays but not ssao', () => {
    expect(qualityToEffects('med')).toMatchObject({ chromaticAberration: true, godRays: true, ssao: false });
  });

  it('high enables everything', () => {
    expect(qualityToEffects('high')).toMatchObject({ godRays: true, ssao: true });
  });
});

describe('settingsQualityToLOD', () => {
  it('maps med → medium and passes low/high through', () => {
    expect(settingsQualityToLOD('low')).toBe('low');
    expect(settingsQualityToLOD('med')).toBe('medium');
    expect(settingsQualityToLOD('high')).toBe('high');
  });
});
