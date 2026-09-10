/**
 * Boot-time graphics negotiation, at the App level.
 *
 * These are the acceptance tests for the thing the whole design exists for: the
 * Canvas mounts once, a quality change never remounts it (so `<Physics>` and the
 * Rapier WASM world survive), and a machine with no WebGL2 gets a static screen
 * instead of an infinite loader.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { GraphicsBoot } from './App';
import {
  CAPTURE_ENVELOPE,
  DEGRADED_ENVELOPE,
  HARDWARE_ENVELOPE,
} from './rendering/probeGraphicsCapability';
import { SAFE_GRAPHICS_ACK_KEY } from './components/SafeGraphicsBadge';

// ---------------------------------------------------------------------------
// Mounts we care about. `Canvas` stands in for the WebGL context and `Experience`
// for everything a remount would destroy — Physics/Rapier, the treadmill, audio.
// ---------------------------------------------------------------------------
const mounts = { canvas: 0, experience: 0 };

vi.mock('@react-three/fiber', () => {
  const React = require('react') as typeof import('react');
  return {
    Canvas: ({ children }: { children?: React.ReactNode }) => {
      React.useEffect(() => {
        mounts.canvas += 1;
      }, []);
      return React.createElement('div', { 'data-testid': 'r3f-canvas' }, children);
    },
    // RendererQualitySync / BootHealthSentinel run inside the mocked Canvas.
    useThree: (selector?: (state: unknown) => unknown) => {
      const state = { gl: null, scene: null, setDpr: () => {} };
      return selector ? selector(state) : state;
    },
    useFrame: () => {},
  };
});

vi.mock('@react-three/drei', () => ({
  useProgress: () => ({ active: false }),
}));

vi.mock('./Experience', () => {
  const React = require('react') as typeof import('react');
  // Named (and capitalised) so it reads as a component to React and to the
  // react-hooks lint rule, not as an anonymous factory that happens to hook.
  const ExperienceMock = () => {
    React.useEffect(() => {
      mounts.experience += 1;
    }, []);
    return React.createElement('div', { 'data-testid': 'experience' });
  };
  return { default: ExperienceMock };
});

import App from './App';
import { useGameStore, type QualityPreset } from './systems/GameState';
import { useSettingsStore } from './systems/settings/useSettingsStore';

const bootFor = (
  tier: 'hardware' | 'degraded' | 'unsupported',
  overrides: Partial<GraphicsBoot['capability']> = {},
  previousFailure: GraphicsBoot['previousFailure'] = null
): GraphicsBoot => ({
  previousFailure,
  capability: {
    tier,
    envelope:
      tier === 'hardware'
        ? HARDWARE_ENVELOPE
        : tier === 'degraded'
          ? DEGRADED_ENVELOPE
          : CAPTURE_ENVELOPE,
    reason: tier === 'degraded' ? 'caveat' : tier === 'unsupported' ? 'no-context' : 'hardware',
    statusMessage: null,
    probed: true,
    ...overrides,
  },
});

const setQuality = (quality: QualityPreset) =>
  act(() => {
    useGameStore.getState().setSettings({ quality });
  });

beforeEach(() => {
  mounts.canvas = 0;
  mounts.experience = 0;
  window.localStorage.clear();
  useGameStore.getState().setSettings({ quality: 'high' });
});

describe('quality changes never remount the Canvas', () => {
  it('keeps one Canvas and one world across low ↔ ultra', () => {
    render(<App graphicsBoot={bootFor('hardware')} />);
    expect(mounts.canvas).toBe(1);
    expect(mounts.experience).toBe(1);

    // The transition that used to destroy the WebGL context and re-init Rapier.
    setQuality('low');
    setQuality('ultra');
    setQuality('medium');
    setQuality('low');

    expect(mounts.canvas).toBe(1);
    expect(mounts.experience).toBe(1);
  });

  it('holds on a degraded envelope too', () => {
    render(<App graphicsBoot={bootFor('degraded')} />);
    setQuality('low');
    setQuality('ultra');
    expect(mounts.canvas).toBe(1);
    expect(mounts.experience).toBe(1);
  });
});

describe('unsupported tier', () => {
  it('renders static DOM and mounts neither R3F nor the world', () => {
    render(
      <App
        graphicsBoot={bootFor('unsupported', { statusMessage: 'GPU process isn’t usable' })}
      />
    );

    expect(screen.getByTestId('graphics-unsupported')).toBeInTheDocument();
    expect(screen.getByText(/GPU process isn’t usable/)).toBeInTheDocument();
    expect(screen.queryByTestId('r3f-canvas')).not.toBeInTheDocument();
    expect(mounts.canvas).toBe(0);
    expect(mounts.experience).toBe(0);
  });

  it('says so when the context exists but our attributes were refused', () => {
    render(<App graphicsBoot={bootFor('unsupported', { reason: 'attributes-rejected' })} />);
    expect(screen.getByText(/depth and stencil buffers/i)).toBeInTheDocument();
    expect(mounts.canvas).toBe(0);
  });
});

describe('safe graphics badge', () => {
  it('is persistent and dismissible on a degraded session', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<App graphicsBoot={bootFor('degraded')} />);

    const badge = screen.getByTestId('safe-graphics-badge');
    expect(badge).toBeInTheDocument();

    // "why?" explains the downgrade in place — no toast, nothing auto-dismissed.
    await user.click(screen.getByRole('button', { name: /why/i }));
    expect(screen.getByText(/refused a hardware-accelerated WebGL context/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /dismiss safe graphics notice/i }));
    expect(screen.queryByTestId('safe-graphics-badge')).not.toBeInTheDocument();
    // The acknowledgement persists; the tier is re-probed every load.
    expect(window.localStorage.getItem(SAFE_GRAPHICS_ACK_KEY)).toBe('1');
  });

  it('names the previous failure when that is why we are in safe mode', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(
      <App
        graphicsBoot={bootFor(
          'degraded',
          { reason: 'previous-boot-failed' },
          { reason: 'context-lost', at: 1 }
        )}
      />
    );

    await user.click(screen.getByRole('button', { name: /why/i }));
    expect(screen.getByText(/lost its WebGL context/i)).toBeInTheDocument();
  });

  it('stays out of the way on a hardware session', () => {
    render(<App graphicsBoot={bootFor('hardware')} />);
    expect(screen.queryByTestId('safe-graphics-badge')).not.toBeInTheDocument();
  });
});

describe('boot-crash guard', () => {
  it('clamps quality to low after a boot that never drew a frame', async () => {
    useSettingsStore.setState({ quality: 'med', _hasHydrated: true });
    render(
      <App
        graphicsBoot={bootFor(
          'degraded',
          { reason: 'previous-boot-failed' },
          { reason: 'no-frame', at: 1 }
        )}
      />
    );

    await waitFor(() => expect(useSettingsStore.getState().quality).toBe('low'));
    expect(useGameStore.getState().settings.quality).toBe('low');
    // Still one Canvas: the clamp is a quality change, and quality changes are live.
    expect(mounts.canvas).toBe(1);
  });

  it('leaves the player\'s persisted quality alone on a healthy boot', async () => {
    // Persisted, not just set: App rehydrates settings on mount, so a bare
    // setState would be overwritten by rehydration rather than by the clamp.
    // ('med' — the settings panel exposes low/med/high; GameState carries ultra.)
    window.localStorage.setItem(
      'watershed-settings',
      JSON.stringify({ state: { quality: 'med' }, version: 1 })
    );
    render(<App graphicsBoot={bootFor('hardware')} />);

    await waitFor(() => expect(useSettingsStore.getState().quality).toBe('med'));
    expect(useSettingsStore.getState().quality).toBe('med');
  });
});
