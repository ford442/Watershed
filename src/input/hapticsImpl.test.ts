import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HAPTIC_ENVELOPES,
  HAPTIC_PRIORITY,
  envelopeDurationMs,
  pulse,
  scaleStep,
  shouldPulse,
  stopHaptics,
  type HapticKind,
} from './hapticsImpl';
import { useGameStore } from '../systems/GameState';
import { useSettingsStore, DEFAULT_SETTINGS } from '../systems/settings/useSettingsStore';
import { inputHub, useInputStore } from './InputHub';
import { GamepadSource } from './sources/GamepadSource';

describe('haptic envelope table', () => {
  const kinds = Object.keys(HAPTIC_ENVELOPES) as HapticKind[];

  it('has exactly the three authored envelopes', () => {
    expect(kinds.sort()).toEqual(['flow', 'impact', 'wipeout']);
  });

  it('keeps every step inside the actuator range and in time order', () => {
    for (const kind of kinds) {
      const steps = HAPTIC_ENVELOPES[kind];
      expect(steps.length).toBeGreaterThan(0);
      let prevAt = -1;
      for (const s of steps) {
        expect(s.atMs).toBeGreaterThanOrEqual(0);
        expect(s.atMs).toBeGreaterThan(prevAt);
        prevAt = s.atMs;
        expect(s.durationMs).toBeGreaterThan(0);
        expect(s.weak).toBeGreaterThanOrEqual(0);
        expect(s.weak).toBeLessThanOrEqual(1);
        expect(s.strong).toBeGreaterThanOrEqual(0);
        expect(s.strong).toBeLessThanOrEqual(1);
      }
    }
  });

  it('flow is soft and both-motor, impact is sharp and short, wipeout is the longest', () => {
    const flow = HAPTIC_ENVELOPES.flow[0];
    expect(flow.weak).toBeGreaterThan(0);
    expect(flow.strong).toBeGreaterThan(0);
    expect(Math.max(flow.weak, flow.strong)).toBeLessThanOrEqual(0.3);

    expect(HAPTIC_ENVELOPES.impact[0].strong).toBe(1);
    expect(HAPTIC_ENVELOPES.impact[0].durationMs).toBeLessThanOrEqual(100);
    expect(envelopeDurationMs('impact')).toBeLessThan(300);

    expect(envelopeDurationMs('wipeout')).toBeGreaterThan(envelopeDurationMs('impact'));
    expect(envelopeDurationMs('wipeout')).toBeGreaterThan(envelopeDurationMs('flow'));
  });

  it('orders priority wipeout > impact > flow', () => {
    expect(HAPTIC_PRIORITY.wipeout).toBeGreaterThan(HAPTIC_PRIORITY.impact);
    expect(HAPTIC_PRIORITY.impact).toBeGreaterThan(HAPTIC_PRIORITY.flow);
  });

  it('scales by force and strength and clamps to 0..1', () => {
    const s = scaleStep(HAPTIC_ENVELOPES.impact[0], 0.5, 0.5);
    expect(s.strong).toBeCloseTo(0.25);
    expect(s.weak).toBeCloseTo(0.15);
    const over = scaleStep(HAPTIC_ENVELOPES.wipeout[0], 5, 5);
    expect(over.weak).toBeLessThanOrEqual(1);
    expect(over.strong).toBeLessThanOrEqual(1);
    expect(scaleStep(HAPTIC_ENVELOPES.impact[0], -1, 1).strong).toBe(0);
  });
});

describe('haptics gate', () => {
  const base = { enabled: true, strength: 1, paused: false, activeSource: 'gamepad' as const };

  it('fires only for a gamepad player in a live run with haptics on', () => {
    expect(shouldPulse(base)).toBe(true);
    expect(shouldPulse({ ...base, enabled: false })).toBe(false);
    expect(shouldPulse({ ...base, strength: 0 })).toBe(false);
    expect(shouldPulse({ ...base, activeSource: 'keyboard-mouse' })).toBe(false);
    expect(shouldPulse({ ...base, activeSource: 'touch' })).toBe(false);
  });

  it('never fires while paused or in a menu', () => {
    expect(shouldPulse({ ...base, paused: true })).toBe(false);
  });
});

describe('pulse()', () => {
  const playEffect = vi.fn(() => Promise.resolve('complete'));
  const reset = vi.fn(() => Promise.resolve('complete'));

  beforeEach(() => {
    vi.useFakeTimers();
    playEffect.mockClear();
    reset.mockClear();
    const pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: [], vibrationActuator: { playEffect, reset } };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    useSettingsStore.setState({ hapticsEnabled: true, hapticsStrength: 1 });
    useGameStore.setState({ isPaused: false });
    // Make the gamepad the active source and the active pad index 0.
    const src = new GamepadSource(
      () => useSettingsStore.getState().padBindings,
      () => ({ deadzone: 0.15, curve: 1 }),
      () => [{ ...pad, buttons: [{ pressed: true, value: 1 }] }],
    );
    src.attach(window);
    window.dispatchEvent(new Event('gamepadconnected'));
    inputHub.reset();
    inputHub.registerSource(src);
    inputHub.tick(16, 1);
    stopHaptics();
    playEffect.mockClear();
  });

  afterEach(() => {
    stopHaptics();
    inputHub.reset();
    useSettingsStore.setState({ hapticsEnabled: DEFAULT_SETTINGS.hapticsEnabled });
    vi.useRealTimers();
  });

  it('plays the impact envelope as timed dual-rumble steps', () => {
    expect(useInputStore.getState().activeSourceId).toBe('gamepad');
    expect(pulse('impact', 1)).toBe(true);
    expect(playEffect).toHaveBeenCalledTimes(1);
    expect(playEffect).toHaveBeenLastCalledWith('dual-rumble', expect.objectContaining({ strongMagnitude: 1, duration: 70 }));
    vi.advanceTimersByTime(80);
    expect(playEffect).toHaveBeenCalledTimes(2);
  });

  it('does nothing while paused, and nothing when disabled in settings', () => {
    useGameStore.setState({ isPaused: true });
    expect(pulse('impact', 1)).toBe(false);
    useGameStore.setState({ isPaused: false });
    useSettingsStore.setState({ hapticsEnabled: false });
    expect(pulse('wipeout', 1)).toBe(false);
    expect(playEffect).not.toHaveBeenCalled();
  });

  it('does not let a flow pulse cut a wipeout short', () => {
    expect(pulse('wipeout', 1)).toBe(true);
    playEffect.mockClear();
    expect(pulse('flow', 1)).toBe(false);
    expect(playEffect).not.toHaveBeenCalled();
  });
});
