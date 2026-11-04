/**
 * #521 B acceptance: a full biome cross-fade does not re-render the scene.
 *
 * TrackSegmentMeshes and PostProcessingPipeline read the biome only through
 * `useBiomeTimeOfDay` / `useBiomeId` (pinned against their source below, since
 * neither mounts without a WebGL context). This drives a real BiomeProvider
 * through a 2 s transition on its captured useFrame and counts the commits of
 * probes that make exactly those reads. The old context re-rendered every
 * consumer once per committed step (BIOME_TRANSITION_STEPS times).
 */
import React, { Profiler } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const frameCallbacks = new Set<(state: unknown, delta: number) => void>();

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: unknown, delta: number) => void) => {
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
  useThree: () => ({}),
}));

import {
  BIOME_TRANSITION_STEPS,
  BiomeProvider,
  useBiomeId,
  useBiomeSelector,
  useBiomeSetters,
  useBiomeStore,
  useBiomeTimeOfDay,
  type BiomeSetters,
} from './BiomeSystem';

/** TrackSegmentMeshes' biome read. */
function SegmentMeshesProbe() {
  useBiomeTimeOfDay();
  return null;
}

/** PostProcessingPipeline's biome reads. */
function PostPipelineProbe() {
  useBiomeTimeOfDay();
  useBiomeId();
  return null;
}

/** A component selecting a cross-fading colour (the worst case a selector allows). */
function FoamProbe() {
  useBiomeSelector((s) => s.currentBiome.foamColor);
  return null;
}

function SettersProbe({ out }: { out: { current: BiomeSetters | null } }) {
  out.current = useBiomeSetters();
  return null;
}

function StoreProbe({ out }: { out: { current: ReturnType<typeof useBiomeStore> | null } }) {
  out.current = useBiomeStore();
  return null;
}

afterEach(() => {
  frameCallbacks.clear();
});

function runFrames(seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 60); i += 1) {
    act(() => {
      for (const cb of frameCallbacks) cb({}, 1 / 60);
    });
  }
}

describe('BiomeProvider render budget (#521 B)', () => {
  it('re-renders the segment-mesh and post-pipeline readers ≤ 3 times across a full 2 s transition', () => {
    const commits = { meshes: 0, post: 0, foam: 0 };
    const setters = { current: null as BiomeSetters | null };
    const store = { current: null as ReturnType<typeof useBiomeStore> | null };
    render(
      <BiomeProvider initialBiome="canyonSummer">
        <Profiler id="meshes" onRender={() => { commits.meshes += 1; }}>
          <SegmentMeshesProbe />
        </Profiler>
        <Profiler id="post" onRender={() => { commits.post += 1; }}>
          <PostPipelineProbe />
        </Profiler>
        <Profiler id="foam" onRender={() => { commits.foam += 1; }}>
          <FoamProbe />
        </Profiler>
        <SettersProbe out={setters} />
        <StoreProbe out={store} />
      </BiomeProvider>,
    );
    const mounted = { ...commits };

    act(() => setters.current!.setBiome('canyonAutumn', 2));
    runFrames(2.2);

    expect(store.current!.getState().isTransitioning).toBe(false);
    expect(store.current!.getState().currentBiome.id).toBe('canyonAutumn');
    expect(commits.meshes - mounted.meshes).toBeLessThanOrEqual(3);
    expect(commits.post - mounted.post).toBeLessThanOrEqual(3);
    // A lerped-colour selector still sees the fade, once per committed step at most.
    expect(commits.foam - mounted.foam).toBeGreaterThan(3);
    expect(commits.foam - mounted.foam).toBeLessThanOrEqual(BIOME_TRANSITION_STEPS + 1);
  });

  it('the setters keep their identity across a transition', () => {
    const seen = new Set<BiomeSetters>();
    function Collect() {
      seen.add(useBiomeSetters());
      useBiomeSelector((s) => s.transitionProgress);
      return null;
    }
    const setters = { current: null as BiomeSetters | null };
    render(
      <BiomeProvider>
        <Collect />
        <SettersProbe out={setters} />
      </BiomeProvider>,
    );
    act(() => setters.current!.setBiome('glacier', 1));
    runFrames(1.2);
    expect(seen.size).toBe(1);
  });
});

describe('scene components read the biome through selectors only', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

  it.each([
    ['components/TrackSegment/TrackSegmentMeshes.tsx', ['useBiomeTimeOfDay']],
    ['components/PostProcessingPipeline.tsx', ['useBiomeTimeOfDay', 'useBiomeId']],
  ])('%s', (file, allowed) => {
    const source = read(file);
    const hooks = [...source.matchAll(/\buseBiome\w*\b/g)].map((m) => m[0]);
    expect(hooks.length).toBeGreaterThan(0);
    for (const hook of hooks) expect(allowed).toContain(hook);
  });
});
