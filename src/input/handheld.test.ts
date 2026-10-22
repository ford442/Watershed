import { afterEach, describe, expect, it } from 'vitest';
import { applyHandheldEnvelope, handheldHudScale, isPortrait, stickRadiusPx } from './handheld';
import { isTouchInputForced, isTouchInputMode, resetTouchInputModeForTest } from './touchMode';

describe('handheld envelope maths', () => {
  it('scales the HUD from 1 at ≥ 720 px down to a floor of 0.7', () => {
    expect(handheldHudScale(1920, 1080)).toBe(1);
    expect(handheldHudScale(844, 390)).toBe(0.7);
    expect(handheldHudScale(900, 600)).toBeCloseTo(600 / 720);
    expect(handheldHudScale(300, 200)).toBe(0.7);
    expect(handheldHudScale(0, 0)).toBe(1);
  });

  it('keeps the stick thumb-sized', () => {
    expect(stickRadiusPx(390, 844)).toBeGreaterThanOrEqual(44);
    expect(stickRadiusPx(3000, 2000)).toBe(90);
  });

  it('detects portrait', () => {
    expect(isPortrait(390, 844)).toBe(true);
    expect(isPortrait(844, 390)).toBe(false);
  });
});

describe('touch input mode', () => {
  const original = window.location.href;
  afterEach(() => {
    window.history.replaceState({}, '', original);
    resetTouchInputModeForTest();
  });

  it('?input=touch forces it', () => {
    expect(isTouchInputForced('?input=touch')).toBe(true);
    expect(isTouchInputForced('?input=script:/x.json')).toBe(false);
    expect(isTouchInputForced('')).toBe(false);
    window.history.replaceState({}, '', '/?input=touch');
    expect(isTouchInputMode()).toBe(true);
  });

  it('is off for a plain desktop load and for a scripted run', () => {
    window.history.replaceState({}, '', '/');
    expect(isTouchInputMode()).toBe(false);
    resetTouchInputModeForTest();
    window.history.replaceState({}, '', '/?input=script:/x.json');
    expect(isTouchInputMode()).toBe(false);
  });

  it('auto-enables on (pointer: coarse)', () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    window.history.replaceState({}, '', '/');
    expect(isTouchInputMode()).toBe(true);
    window.matchMedia = original;
  });
});

describe('applyHandheldEnvelope', () => {
  it('publishes viewport variables and the touch-input class, then cleans up', () => {
    const root = document.createElement('html');
    const off = applyHandheldEnvelope(root);
    expect(root.classList.contains('touch-input')).toBe(true);
    expect(root.style.getPropertyValue('--hud-scale')).not.toBe('');
    expect(root.style.getPropertyValue('--vv-w')).toMatch(/px$/);
    expect(['portrait', 'landscape']).toContain(root.dataset.orientation);
    off();
    expect(root.classList.contains('touch-input')).toBe(false);
    expect(root.style.getPropertyValue('--hud-scale')).toBe('');
  });
});
