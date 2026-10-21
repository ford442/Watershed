/**
 * #503 B: the scene root must not re-render with per-frame store writes.
 *
 * batchFrameUpdate (driven from useExperienceLifecycle's useFrame) writes
 * `currentSpeed` every frame. useSegmentAudio used to subscribe to it, so
 * InnerExperience — whose hooks are exactly `useInnerExperience` — rendered
 * once per frame. This drives 120 real frames through the hooks with the
 * vehicle's speed changing every frame and counts commits with a Profiler.
 */
import React, { Profiler } from 'react';
import { act, render } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const frameCallbacks = new Set<(state: unknown, delta: number) => void>();
const camera = new THREE.PerspectiveCamera();

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: unknown, delta: number) => void) => {
    // Register on mount, like R3F; the latest closure wins per component.
    const React = require('react') as typeof import('react');
    const ref = React.useRef(cb);
    ref.current = cb;
    React.useEffect(() => {
      const run = (state: unknown, delta: number) => ref.current(state, delta);
      frameCallbacks.add(run);
      return () => {
        frameCallbacks.delete(run);
      };
    }, []);
  },
  useThree: () => ({ camera, scene: new THREE.Scene(), gl: {} }),
}));

vi.mock('../../systems/biome/BiomeSystem', () => ({
  useBiome: () => ({ currentBiome: 'canyonSummer', transitionProgress: 1, setBiome: () => {}, snapBiome: () => {} }),
  useBiomeMaterials: () => ({}),
}));

vi.mock('../../systems/lod/LODManager', () => ({
  useLOD: () => ({ quality: 'high' }),
}));

import { useInnerExperience } from './useInnerExperience';
import { useGameStore } from '../../systems/GameState';
import type { DebugStageController } from '../../debug/debugStages';

const debug = {
  debugEnabled: false,
  isStageEnabled: () => true,
  // Stage bodies (audio init, …) are not what this test measures.
  runStage: async () => undefined,
  setStageEnabled: () => {},
  setStageLoading: () => {},
  setStageSuccess: () => {},
  setStageFailure: () => {},
} as unknown as DebugStageController;

function Probe({ speedRef }: { speedRef: { current: number } }) {
  const inner = useInnerExperience({ debug, mapId: 'meander' });
  // A moving body the lifecycle hook reads every frame.
  inner.vehicleRef.current = {
    linvel: () => ({ x: 0, y: 0, z: -speedRef.current }),
    translation: () => ({ x: 0, y: -6, z: -10 - speedRef.current }),
  } as unknown as typeof inner.vehicleRef.current;
  return null;
}

afterEach(() => {
  frameCallbacks.clear();
});

describe('InnerExperience render budget (#503 B)', () => {
  it('renders at most twice over 120 frames while the speed changes every frame', () => {
    const speedRef = { current: 0 };
    let commits = 0;
    render(
      <Profiler id="inner" onRender={() => { commits += 1; }}>
        <Probe speedRef={speedRef} />
      </Profiler>,
    );
    const mountCommits = commits;
    expect(frameCallbacks.size).toBeGreaterThan(0);

    for (let frame = 0; frame < 120; frame += 1) {
      // One act per frame: R3F frames are separate tasks, so React commits
      // between them — a single act around the loop would batch the 120 writes.
      act(() => {
        speedRef.current = 3 + (frame % 17) * 0.7;
        for (const cb of [...frameCallbacks]) cb({ camera, clock: { elapsedTime: frame / 60 } }, 1 / 60);
      });
    }

    // The frames really did reach the store…
    expect(useGameStore.getState().currentSpeed).toBeGreaterThan(0);
    // …and the scene root's hooks did not re-render with them.
    expect(commits - mountCommits).toBeLessThanOrEqual(2);
  });
});
