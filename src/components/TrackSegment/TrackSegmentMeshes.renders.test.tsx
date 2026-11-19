/**
 * #574 E.3: a steady-state frame re-renders no segment component.
 *
 * TrackSegmentMeshes does not mount without a WebGL context, so its frame loop is
 * pinned against its source; the particle effects it feeds take the sampled speed
 * as a ref, which WaterfallParticles is driven through here: its fade follows the
 * ref with zero commits. The frame loop's distance write notifies the store only
 * when the whole metre changes.
 */
import React, { Profiler, forwardRef, useImperativeHandle } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import type * as THREE from 'three';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  frames: [] as ((state: unknown, delta: number) => void)[],
  material: null as { opacity: number } | null,
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: unknown, delta: number) => void) => {
    h.frames.push(cb);
  },
}));

vi.mock('../../systems/lod/LODManager', () => ({
  useLOD: () => ({ config: { particleDensity: 1, maxParticles: 500 } }),
}));

vi.mock('../../sim/nativeOwner', () => ({
  resolveNativeOwner: () => Promise.resolve({ kind: 'none' }),
}));

// The spray light rides a DOM <group> here; the pool is not under test.
vi.mock('../../rendering/sceneLightPool', () => ({ usePooledPointLights: () => [] }));

vi.mock('../../rendering/instancing/NonEmptyInstancedMesh', () => ({
  NonEmptyInstancedMesh: forwardRef(function FakeMesh(
    { args }: { args: [unknown, THREE.Material, number] },
    ref: React.Ref<unknown>,
  ) {
    h.material = args[1];
    useImperativeHandle(ref, () => ({
      material: args[1],
      setMatrixAt: () => {},
      instanceMatrix: { needsUpdate: false },
    }));
    return null;
  }),
}));

import WaterfallParticles from '../Environment/WaterfallParticles';
import { useGameStore } from '../../systems/GameState';

afterEach(() => {
  h.frames.length = 0;
});

function frames(n: number) {
  for (let i = 0; i < n; i += 1) {
    act(() => {
      for (const frame of h.frames) frame({ clock: { elapsedTime: i / 60 } }, 1 / 60);
    });
  }
}

describe('segment particle inputs are refs, not React state (#574 E.3)', () => {
  it('TrackSegmentMeshes sets no React state from its frame loop', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'TrackSegmentMeshes.tsx'), 'utf8');
    const setters = [...source.matchAll(/\[\s*\w+\s*,\s*(set\w+)\s*\]\s*=\s*useState/g)].map((m) => m[1]);
    // Only the slot-canyon foam list, which CanyonDecorations reports from an effect.
    expect(setters).toEqual(['setCanyonRockFoam']);
    expect(source).not.toMatch(/playerVelocityForParticles/);
  });

  it('WaterfallParticles follows the speed ref with no re-render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // <group> in react-dom
    const velocity = { current: 0 };
    let commits = 0;
    render(
      <Profiler id="falls" onRender={() => { commits += 1; }}>
        <WaterfallParticles count={300} playerVelocityRef={velocity} />
      </Profiler>,
    );
    const mounted = commits;

    // Standing still: the spray fades out (0.5 / s).
    frames(150);
    expect(h.material!.opacity).toBeCloseTo(0, 5);
    // Moving: it fades back in, read from the ref inside useFrame.
    velocity.current = 12;
    frames(60);
    expect(h.material!.opacity).toBeCloseTo(0.6, 5);
    velocity.current = 25;
    frames(60);

    expect(commits).toBe(mounted);
    vi.restoreAllMocks();
  });

  it('setDistance notifies the store only when the metre changes', () => {
    useGameStore.getState().resetGameState();
    const listener = vi.fn();
    const unsub = useGameStore.subscribe(listener);
    const { setDistance } = useGameStore.getState();
    setDistance(12);
    setDistance(12);
    setDistance(12);
    setDistance(13);
    unsub();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(useGameStore.getState().distance).toBe(13);
  });
});
