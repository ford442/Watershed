/**
 * #521 C2: `window.__watershedScreenshot` is installed on a `?screenshot=1`
 * page only, from a lazy chunk, and removed with the world hook.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-three/fiber', () => ({
  useFrame: () => {},
  useThree: () => ({}),
}));

import { useScreenshotApi } from './useScreenshotApi';
import type { ScreenshotApiContext } from './screenshotApi';

function Probe({ spawnPoints }: { spawnPoints: ScreenshotApiContext['spawnPoints'] }) {
  const vehicleRef = React.useRef(null);
  const trackManagerRef = React.useRef(null);
  useScreenshotApi({
    vehicleRef,
    trackManagerRef,
    spawnPoints,
    currentSegmentIndex: 0,
    mapStartIndex: 0,
    setCurrentSegmentIndex: () => {},
    setRespawnSegmentIndex: () => {},
  });
  return null;
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
  delete window.__watershedScreenshot;
});

describe('useScreenshotApi (#521 C2)', () => {
  it('installs the harness API on ?screenshot=1 and removes it on unmount', async () => {
    window.history.replaceState({}, '', '/?screenshot=1');
    const spawn = { x: 1, y: 2, z: 3 } as ScreenshotApiContext['spawnPoints'][number];
    const { rerender, unmount } = render(<Probe spawnPoints={{}} />);

    // The first load transforms the chunk's whole import graph (cold: ~1 s).
    await waitFor(() => expect(window.__watershedScreenshot?.stepScripted).toBeTypeOf('function'), {
      timeout: 15_000,
    });
    const api = window.__watershedScreenshot!;
    expect(Object.keys(api).sort()).toEqual(
      [
        'advanceTreadmill',
        'getGhostFile',
        'getScriptedReadiness',
        'getScriptedTelemetry',
        'getSpawnPoints',
        'getSplitChecksums',
        'getSplits',
        'isScriptedReady',
        'stepScripted',
        'teleportToSegment',
        'teleportToZ',
      ].sort(),
    );
    // No vehicle body yet: teleports report that they did not land.
    expect(api.teleportToSegment(3)).toBe(false);

    // Once loaded, a deps change reinstalls synchronously with the new values.
    rerender(<Probe spawnPoints={{ 4: spawn }} />);
    expect(window.__watershedScreenshot).not.toBe(api);
    expect(window.__watershedScreenshot?.getSpawnPoints()).toEqual({ 4: spawn });

    unmount();
    expect(window.__watershedScreenshot).toBeUndefined();
  });

  it('installs nothing without the flag', async () => {
    render(<Probe spawnPoints={{}} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.__watershedScreenshot).toBeUndefined();
  });
});
