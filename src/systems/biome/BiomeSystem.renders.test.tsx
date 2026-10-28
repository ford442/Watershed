/**
 * #521 B: a biome cross-fade is visual, and costs React almost nothing.
 *
 * The provider commits the cross-fade's progress to a transient store (one
 * commit per progress step) and re-renders only what a render can see: the
 * target, transitioning vs settled, the coarse time of day. `TrackSegmentMeshes`
 * (every live segment) and `PostProcessingPipeline` read `useBiome()` for
 * `timeOfDay` and the biome id; a 2 s cross-fade must render each of them at
 * most three times, not once per progress step (48).
 *
 * The probes below make exactly the `useBiome()` reads those two components
 * make — and a source check pins that the real files still make only those.
 */
import React, { useEffect } from 'react';
import { readFileSync } from 'node:fs';
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
  useThree: () => ({ scene: {} }),
}));

import { getBiomePalette } from '../../configs/BiomePalettes';
import {
  BIOME_TRANSITION_STEPS,
  BiomeProvider,
  useBiome,
  useBiomeActions,
  useBiomeMaterials,
  useBiomeStore,
  useBiomeView,
} from './BiomeSystem';

afterEach(() => {
  frameCallbacks.clear();
  for (const key of Object.keys(renders)) delete renders[key];
});

const DT = 1 / 60;

function runFrames(seconds: number) {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i += 1) {
    // One act per frame: R3F frames are separate tasks, so React commits between them.
    act(() => {
      for (const cb of [...frameCallbacks]) cb({}, DT);
    });
  }
}

/** Render counts per probe id (a probe counts itself in its render body). */
const renders: Record<string, number> = {};
const count = (id: string) => {
  renders[id] = (renders[id] ?? 0) + 1;
};
/** Renders since the probe mounted. */
const rendersAfterMount = (id: string) => (renders[id] ?? 0) - 1;

function MeshesProbe() {
  // TrackSegmentMeshes: `const { timeOfDay } = useBiome();`
  const { timeOfDay } = useBiome();
  count('meshes');
  return <span data-tod={timeOfDay} />;
}

function PostProbe() {
  // PostProcessingPipeline: `const { timeOfDay, currentBiome } = useBiome();` (id read in its frame loop)
  const { timeOfDay, currentBiome } = useBiome();
  count('post');
  return <span data-tod={timeOfDay} data-id={currentBiome?.id} />;
}

function SceneRootProbe() {
  // useInnerExperience / useExperienceWorld / ReachManager: the setters only.
  const { setBiome } = useBiomeActions();
  count('root');
  useEffect(() => {
    api.setBiome = setBiome;
  }, [setBiome]);
  return null;
}

const api = { setBiome: (_id: never, _d?: number) => {} } as { setBiome: (id: never, duration?: number) => void };

describe('a biome cross-fade, as React sees it (#521 B)', () => {
  it('renders TrackSegmentMeshes- and PostProcessingPipeline-style readers at most 3 times over a full 2 s fade', () => {
    render(
      <BiomeProvider initialBiome="canyonSummer">
        <MeshesProbe />
        <PostProbe />
        <SceneRootProbe />
      </BiomeProvider>,
    );

    act(() => {
      api.setBiome('glacier' as never, 2);
    });
    runFrames(2.2);

    // Renders, mount included: at most 3 (the mount, the fade starting, the fade settling).
    expect(renders.meshes).toBeLessThanOrEqual(3);
    expect(renders.post).toBeLessThanOrEqual(3);
    // They did see the fade begin and settle (not frozen at the start).
    expect(rendersAfterMount('meshes')).toBe(2);
    // The setters never re-render anyone.
    expect(rendersAfterMount('root')).toBe(0);
  });

  it('commits every progress step to the store, for per-frame readers, with no render', () => {
    const seen: { fog: string[]; commits: number; sameObject: boolean; live: unknown } = {
      fog: [],
      commits: 0,
      sameObject: true,
      live: null,
    };
    function FrameReader() {
      const store = useBiomeStore();
      const { currentBiome } = useBiome();
      seen.live = seen.live ?? currentBiome;
      count('frameReader');
      useEffect(
        () =>
          store.subscribe(() => {
            seen.commits += 1;
            seen.fog.push(currentBiome.fogColor);
            if (store.getLivePalette() !== currentBiome) seen.sameObject = false;
          }),
        [store, currentBiome],
      );
      return null;
    }
    render(
      <BiomeProvider initialBiome="canyonSummer">
        <FrameReader />
        <SceneRootProbe />
      </BiomeProvider>,
    );
    act(() => {
      api.setBiome('glacier' as never, 2);
    });
    runFrames(2.2);

    // One for the start, then one per progress step through the settle.
    expect(seen.commits).toBe(1 + BIOME_TRANSITION_STEPS);
    // The stable palette object the context hands out was updated in place, and ends on the target.
    expect(seen.sameObject).toBe(true);
    expect(new Set(seen.fog).size).toBeGreaterThan(20);
    expect(seen.fog[seen.fog.length - 1]).toBe(getBiomePalette('glacier').fogColor);
    // …while the reader itself rendered only for the rare context changes.
    expect(renders.frameReader).toBeLessThanOrEqual(3);
  });

  it('lets a reader opt in to a re-render per step (useBiomeView / useBiomeMaterials)', () => {
    let flow = 0;
    function ViewReader() {
      const view = useBiomeView();
      count('view');
      return <span data-p={view.transitionProgress} />;
    }
    function MaterialsReader() {
      flow = useBiomeMaterials().water.flowSpeed;
      count('materials');
      return null;
    }
    render(
      <BiomeProvider initialBiome="canyonSummer">
        <ViewReader />
        <MaterialsReader />
        <SceneRootProbe />
      </BiomeProvider>,
    );
    act(() => {
      api.setBiome('glacier' as never, 2);
    });
    runFrames(2.2);
    expect(renders.view).toBeGreaterThan(40);
    expect(renders.materials).toBeGreaterThan(40);
    expect(flow).toBe(getBiomePalette('glacier').flowSpeed);
  });

  it('settles on the target: the context says so, and the live palette is the target\'s', () => {
    let ctx: ReturnType<typeof useBiome> | null = null;
    function Reader() {
      ctx = useBiome();
      return null;
    }
    render(
      <BiomeProvider initialBiome="canyonSummer">
        <Reader />
        <SceneRootProbe />
      </BiomeProvider>,
    );
    act(() => {
      api.setBiome('glacier' as never, 1);
    });
    expect(ctx!.isTransitioning).toBe(true);
    expect(ctx!.targetBiome.id).toBe('glacier');
    // The fade reads as the target biome's id from its first frame.
    expect(ctx!.currentBiome.id).toBe('glacier');
    runFrames(1.2);
    expect(ctx!.isTransitioning).toBe(false);
    expect(ctx!.transitionProgress).toBe(1);
    expect(ctx!.currentBiome.fogColor).toBe(getBiomePalette('glacier').fogColor);
  });

  it('never mutates the shared palette tables', () => {
    const summer = { ...getBiomePalette('canyonSummer') };
    const glacier = { ...getBiomePalette('glacier') };
    render(
      <BiomeProvider initialBiome="canyonSummer">
        <SceneRootProbe />
      </BiomeProvider>,
    );
    act(() => {
      api.setBiome('glacier' as never, 1);
    });
    runFrames(1.2);
    expect(getBiomePalette('canyonSummer')).toEqual(summer);
    expect(getBiomePalette('glacier')).toEqual(glacier);
  });
});

describe('the real consumers read only what the probes read', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const destructured = (src: string) =>
    [...src.matchAll(/const \{([^}]*)\}\s*=\s*useBiome\(\)/g)].map((m) =>
      m[1].split(',').map((f) => f.trim()).filter(Boolean),
    );

  it('TrackSegmentMeshes: `{ timeOfDay }` only, and no per-step hook', () => {
    const src = read('../../components/TrackSegment/TrackSegmentMeshes.tsx');
    expect(destructured(src)).toEqual([['timeOfDay']]);
    expect(src).not.toMatch(/useBiomeView|useBiomeMaterials/);
  });

  it('PostProcessingPipeline: `{ timeOfDay, currentBiome }` only, and no per-step hook', () => {
    const src = read('../../components/PostProcessingPipeline.tsx');
    expect(destructured(src)).toEqual([['timeOfDay', 'currentBiome']]);
    expect(src).not.toMatch(/useBiomeView|useBiomeMaterials/);
    // It reads the biome in its frame loop only as an id.
    expect(src).toMatch(/biomeId: currentBiome\?\.id/);
  });

  it('the scene root hooks take the setters, not the palette', () => {
    expect(read('../../experience/hooks/useInnerExperience.ts')).not.toMatch(/useBiome/);
    expect(read('../../experience/hooks/useExperienceWorld.ts')).toMatch(/useBiomeActions/);
    expect(read('../../experience/hooks/useExperienceWorld.ts')).not.toMatch(/\buseBiome\(/);
    expect(read('../../experience/ReachManager.tsx')).not.toMatch(/\buseBiome\(/);
  });
});
