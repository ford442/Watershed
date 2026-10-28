import { describe, expect, it, beforeEach, vi } from 'vitest';
import { BIOME_IDS } from '../../configs/biomes';
import { SimCore } from '../../sim/core/SimCore';
import { SurfaceMaterial } from '../vehicle/surfaceMaterial';
import { useGameStore } from '../GameState';
import { resolveGameplayProfile } from '../map/MapSystem';
import {
  BIOME_GAMEPLAY_PROFILES,
  COLD_AMBIENT_TEMP,
  composeGameplayProfile,
  gameplayProfileForBiome,
  type GameplayProfile,
} from './gameplayProfile';
import {
  getActiveGameplayProfile,
  resetActiveGameplayProfileForTests,
  subscribeGameplaySurface,
} from './activeGameplayProfile';

const live = vi.hoisted(() => ({
  manager: null as null | { biome: string; gameplay: unknown },
}));

vi.mock('../map/ChunkManager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../map/ChunkManager')>()),
  getLiveChunkManager: () =>
    live.manager && {
      getCurrentBiome: () => live.manager!.biome,
      getCommittedGameplay: () => live.manager!.gameplay,
    },
}));

import { createGameplayProfileSimSystem, GAMEPLAY_PROFILE_BLEND_SEC } from './gameplaySimSystem';

/** The live treadmill committed `biome` with `gameplay` (the store follows, as BiomeProvider does). */
function commit(biome: string, gameplay: unknown = BIOME_GAMEPLAY_PROFILES[biome as keyof typeof BIOME_GAMEPLAY_PROFILES]) {
  live.manager = { biome, gameplay };
  useGameStore.setState({ currentBiome: biome as never });
}

describe('GameplayProfile table', () => {
  it('has a row for every biome', () => {
    for (const id of BIOME_IDS) expect(BIOME_GAMEPLAY_PROFILES[id]).toBeDefined();
  });

  it('reproduces the values the readers used before the split', () => {
    // flowCap = the old palette flowSpeed; surface = MATERIAL_FROM_BIOME; ambient = survival's table.
    expect(gameplayProfileForBiome('canyonSummer')).toEqual({
      flowCap: 1.0, surface: SurfaceMaterial.ROCK, ambientTemp: 0.88, windDry: 1,
    });
    expect(gameplayProfileForBiome('glacier').ambientTemp).toBeLessThan(COLD_AMBIENT_TEMP);
    expect(gameplayProfileForBiome('lumberFlume').surface).toBe(SurfaceMaterial.WOOD);
    expect(gameplayProfileForBiome('hydroDam').flowCap).toBe(1.85);
  });

  it('normalises legacy aliases', () => {
    expect(gameplayProfileForBiome('creek-autumn')).toBe(BIOME_GAMEPLAY_PROFILES.canyonAutumn);
  });

  it('lays an authored override over the biome row, ignoring junk', () => {
    const p = composeGameplayProfile('glacier', {
      flowCap: 0.5,
      ambientTemp: Number.NaN,
      surface: 'lava' as SurfaceMaterial,
    });
    expect(p.flowCap).toBe(0.5);
    expect(p.ambientTemp).toBe(BIOME_GAMEPLAY_PROFILES.glacier.ambientTemp);
    expect(p.surface).toBe(BIOME_GAMEPLAY_PROFILES.glacier.surface);
    expect(composeGameplayProfile('glacier')).toBe(BIOME_GAMEPLAY_PROFILES.glacier);
  });

  it('is what MapSystem resolves for a segment config', () => {
    expect(resolveGameplayProfile({ biome: 'delta', gameplay: { windDry: 2 } })).toEqual({
      ...BIOME_GAMEPLAY_PROFILES.delta,
      windDry: 2,
    });
  });
});

describe('gameplay-profile sim system', () => {
  let core: SimCore;

  beforeEach(() => {
    resetActiveGameplayProfileForTests();
    live.manager = null;
    useGameStore.setState({ currentBiome: 'canyonSummer' });
    core = new SimCore();
    core.register(createGameplayProfileSimSystem());
  });

  const steps = (c: SimCore, n: number) => {
    for (let i = 0; i < n; i += 1) c.step();
  };

  it('takes a change at once by default (the ruler: no blend, no behaviour change)', () => {
    expect(GAMEPLAY_PROFILE_BLEND_SEC).toBe(0);
    commit('canyonSummer');
    steps(core, 1);
    commit('glacier');
    steps(core, 1);
    expect(getActiveGameplayProfile()).toEqual(BIOME_GAMEPLAY_PROFILES.glacier);
  });

  it('falls back to the committed store biome with no live treadmill', () => {
    useGameStore.setState({ currentBiome: 'glacier' });
    steps(core, 1);
    expect(getActiveGameplayProfile()).toEqual(BIOME_GAMEPLAY_PROFILES.glacier);
  });

  it('follows the store when it disagrees with the treadmill (reach transition, respawn snap)', () => {
    commit('canyonSummer');
    useGameStore.setState({ currentBiome: 'delta' });
    steps(core, 1);
    expect(getActiveGameplayProfile()).toEqual(BIOME_GAMEPLAY_PROFILES.delta);
  });

  it('applies a committed segment override (same biome, different profile)', () => {
    commit('canyonSummer', resolveGameplayProfile({ biome: 'canyonSummer', gameplay: { flowCap: 3 } }));
    steps(core, 1);
    expect(getActiveGameplayProfile().flowCap).toBe(3);
  });

  it('blends in sim time when given a window, the same at any frame rate', () => {
    const sample = (frameDelta: number) => {
      resetActiveGameplayProfileForTests();
      const c = new SimCore();
      c.register(createGameplayProfileSimSystem({ blendSec: 1 }));
      commit('canyonSummer');
      c.step();
      commit('glacier');
      let t = 0;
      while (t < 0.5 - 1e-9) {
        c.advance(frameDelta);
        t += frameDelta;
      }
      const mid = { ...getActiveGameplayProfile() };
      steps(c, 70);
      return { mid, end: { ...getActiveGameplayProfile() } };
    };
    const a = sample(1 / 60);
    expect(a.mid.flowCap).toBeGreaterThan(1.0);
    expect(a.mid.flowCap).toBeLessThan(1.4);
    expect(a.mid.ambientTemp).toBeLessThan(0.88);
    expect(a.mid.ambientTemp).toBeGreaterThan(0.35);
    expect(a.end).toEqual(BIOME_GAMEPLAY_PROFILES.glacier);
    expect(sample(1 / 30)).toEqual(a);
  });

  it('snaps after a run reset, even with a blend window', () => {
    const c = new SimCore();
    c.register(createGameplayProfileSimSystem({ blendSec: 1 }));
    commit('glacier');
    c.step();
    commit('delta');
    c.reset();
    c.step();
    expect(getActiveGameplayProfile()).toEqual(BIOME_GAMEPLAY_PROFILES.delta);
  });

  it('tells surface listeners about a change of surface only', () => {
    const heard: SurfaceMaterial[] = [];
    subscribeGameplaySurface((s) => heard.push(s));
    commit('canyonSummer');
    steps(core, 10);
    expect(heard).toEqual([]);
    commit('canyonAutumn');
    steps(core, 5);
    expect(heard).toEqual([SurfaceMaterial.MOSS]);
  });

  it('allocates no profile per step (the active profile is one object)', () => {
    const active: Readonly<GameplayProfile> = getActiveGameplayProfile();
    commit('glacier');
    steps(core, 5);
    expect(getActiveGameplayProfile()).toBe(active);
  });
});
