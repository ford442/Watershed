/**
 * #503 F: a map loop / switch builds the forecast for the run's *active* hour.
 *
 * resetDefaultMapRun started the new session at getActiveLaunchHour() but built
 * the forecast from the launchHour captured when the callback was last created
 * — and launchHour was not one of its dependencies. After the hour changed
 * (a new run from the menu), looping the map forecast the previous hour.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-three/fiber', () => ({
  useFrame: () => {},
  useThree: () => ({}),
}));

// Stable identities, like BiomeProvider's useCallback'd setters: a fresh
// function per render would recreate resetDefaultMapRun and hide the bug.
vi.mock('../../systems/biome/BiomeSystem', () => {
  const biome = { currentBiome: 'canyonSummer', setBiome: () => {}, snapBiome: () => {} };
  return { useBiome: () => biome };
});

import { useExperienceWorld } from './useExperienceWorld';
import { initRunSession, resetRunSessionForTests } from '../../systems/journey/runSession';
import type { DebugStageController } from '../../debug/debugStages';

const debug = {
  debugEnabled: false,
  isStageEnabled: () => true,
  runStage: async () => undefined,
  setStageEnabled: () => {},
  setStageLoading: () => {},
  setStageSuccess: () => {},
  setStageFailure: () => {},
} as unknown as DebugStageController;

type World = ReturnType<typeof useExperienceWorld>;

function Probe({ launchHour, onWorld }: { launchHour: number; onWorld: (w: World) => void }) {
  // Stable refs, as InnerExperience holds them (fresh objects would be new deps).
  const vehicleRef = React.useRef(null);
  const trackManagerRef = React.useRef(null);
  const awardedWaterfallSegmentsRef = React.useRef(new Set<number>());
  const world = useExperienceWorld({
    debug,
    vehicleRef,
    trackManagerRef,
    awardedWaterfallSegmentsRef,
    mapId: 'meander',
    launchHour,
  });
  onWorld(world);
  return null;
}

afterEach(() => {
  resetRunSessionForTests();
});

describe('useExperienceWorld forecast hour (#503 F)', () => {
  it('looping the map forecasts the active run hour, not a stale one', () => {
    let world!: World;
    const onWorld = (w: World) => {
      world = w;
    };

    initRunSession({ mapId: 'meander', launchHour: 6 });
    const { rerender } = render(<Probe launchHour={6} onWorld={onWorld} />);
    expect(world.forecastSamples[0].hour).toBe(6);

    // A new run from the menu at 18:00 — same mount, new hour.
    initRunSession({ mapId: 'meander', launchHour: 18 });
    rerender(<Probe launchHour={18} onWorld={onWorld} />);
    expect(world.forecastSamples[0].hour).toBe(18);

    act(() => world.handleLoopCurrentMap());

    expect(world.forecastSamples[0].hour).toBe(18);
  });
});
