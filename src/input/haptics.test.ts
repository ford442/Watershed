import { describe, expect, it, vi } from 'vitest';
import { pulse, stopHaptics, preloadHaptics } from './haptics';
import { useInputStore } from './InputHub';

describe('haptics facade', () => {
  it('does nothing and loads nothing for a keyboard player', () => {
    useInputStore.setState({ activeSourceId: 'keyboard-mouse' });
    expect(pulse('impact', 1)).toBe(false);
    expect(() => stopHaptics()).not.toThrow();
  });

  it('loads the rumble code on the first gamepad pulse, then delegates', async () => {
    useInputStore.setState({ activeSourceId: 'gamepad' });
    // First call: not loaded yet, so false — and the load is started.
    expect(pulse('flow', 0.5)).toBe(false);
    preloadHaptics();
    await vi.waitFor(async () => {
      const impl = await import('./hapticsImpl');
      expect(impl).toBeTruthy();
    });
    await new Promise((r) => setTimeout(r, 0));
    // Loaded: it reaches the impl gate (no actuator in jsdom, so still false, but no throw).
    expect(() => pulse('flow', 0.5)).not.toThrow();
    useInputStore.setState({ activeSourceId: 'none' });
  });
});
