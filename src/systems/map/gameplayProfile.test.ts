import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIOME_IDS } from '../../configs/biomes';
import { getBiomePalette } from '../../configs/BiomePalettes';
import { SIM_DT, SimCore } from '../../sim/core/SimCore';
import { gameEvents } from '../events/GameEvents';
import { useGameStore } from '../GameState';
import {
  createGameplayProfileSimSystem,
  getGameplayProfile,
  resetGameplayProfileForTests,
  setGameplayProfileTarget,
} from './gameplayProfile';
import { resolveGameplayProfile } from './gameplayProfileTable';
import { JSONMapManager, resolveSegmentGameplayProfile } from './MapSystem';
import glacialLevel from '../../maps/glacial_source.json';
import type { LevelData } from './MapSystem';

/**
 * The flow cap per biome as the palettes' `flowSpeed` stood when the cap left
 * the palette (#521 B). Literals on purpose: this is the gameplay table, and a
 * palette retune must not be able to move it.
 */
const LEGACY_FLOW_CAP: Record<string, number> = {
  canyonSummer: 1.0,
  canyonAutumn: 0.9,
  slotCanyon: 1.1,
  glacialMelt: 1.85,
  glacier: 1.4,
  delta: 0.28,
  alpineSpring: 1.2,
  cavern: 0.6,
  midnightMist: 0.7,
  lumberFlume: 1.55,
  hydroDam: 1.85,
};

afterEach(() => {
  resetGameplayProfileForTests();
  useGameStore.setState({ currentBiome: 'canyonSummer' });
});

describe('resolveGameplayProfile', () => {
  it('carries the legacy flow cap of every biome, so no authored map\'s water moves', () => {
    expect(Object.keys(LEGACY_FLOW_CAP).sort()).toEqual([...BIOME_IDS].sort());
    for (const id of BIOME_IDS) expect(resolveGameplayProfile(id).flowCap).toBe(LEGACY_FLOW_CAP[id]);
  });

  it('does not read the palette: retuning a biome\'s flowSpeed moves nothing', () => {
    const palette = getBiomePalette('glacier');
    const original = palette.flowSpeed;
    try {
      palette.flowSpeed = 7;
      expect(resolveGameplayProfile('glacier').flowCap).toBe(1.4);
    } finally {
      palette.flowSpeed = original;
    }
  });

  it('steps at a boundary by default (blendSec 0, the pinned cap\'s behaviour)', () => {
    for (const id of BIOME_IDS) expect(resolveGameplayProfile(id).blendSec).toBe(0);
  });

  it('derives cold from the biome and folds authored slipperiness into the grip', () => {
    expect(resolveGameplayProfile('glacier').cold).toBeCloseTo(0.65, 9);
    expect(resolveGameplayProfile('canyonSummer').cold).toBeCloseTo(0.12, 9);
    expect(resolveGameplayProfile('canyonSummer').friction).toBe(1);
    expect(resolveGameplayProfile('glacialMelt', 0.8).friction).toBeCloseTo(0.2, 9);
    expect(resolveGameplayProfile('glacialMelt', 7).friction).toBe(0);
    expect(resolveGameplayProfile('glacialMelt', Number.NaN).friction).toBe(1);
    expect(resolveGameplayProfile('canyonSummer').wind).toBe(0);
  });

  it('gives an unknown biome id the default biome\'s row, like the palette lookup it replaced', () => {
    expect(resolveGameplayProfile('not-a-biome')).toEqual(resolveGameplayProfile('canyonSummer'));
  });

  it('returns a fresh object each time (the table is frozen, callers may not alias it)', () => {
    const a = resolveGameplayProfile('delta');
    a.flowCap = 99;
    expect(resolveGameplayProfile('delta').flowCap).toBe(0.28);
  });
});

describe('resolveSegmentGameplayProfile (MapSystem)', () => {
  it('reads the segment\'s biome and authored slipperiness off the map', () => {
    const manager = new JSONMapManager(glacialLevel as unknown as LevelData);
    const profile = resolveSegmentGameplayProfile(manager, 0);
    const config = manager.getChunkConfig(0);
    expect(profile.flowCap).toBe(LEGACY_FLOW_CAP[config.biome]);
    expect(profile.friction).toBeCloseTo(1 - (config.slipperiness ?? 0), 9);
    expect(config.slipperiness ?? 0).toBeGreaterThan(0);
  });
});

describe('the live profile and its sim system', () => {
  let core: SimCore;
  let off: () => void;
  beforeEach(() => {
    core = new SimCore();
    off = core.register(createGameplayProfileSimSystem());
  });
  afterEach(() => off());

  it('starts where the run is: the committed biome the store already holds', () => {
    off();
    resetGameplayProfileForTests();
    useGameStore.setState({ currentBiome: 'glacialMelt' });
    core = new SimCore();
    off = core.register(createGameplayProfileSimSystem());
    expect(getGameplayProfile().flowCap).toBe(1.85);
  });

  it('follows the treadmill\'s biome commit, at that moment', () => {
    expect(getGameplayProfile().flowCap).toBe(1.0);
    gameEvents.emit('biome-change', { biome: 'glacier', segmentIndex: -3 });
    expect(getGameplayProfile().flowCap).toBe(1.4);
    gameEvents.emit('biome-change', { biome: 'canyonSummer', segmentIndex: 0 });
    expect(getGameplayProfile().flowCap).toBe(1.0);
  });

  it('does not move with the store\'s biome id or the palette — only with the profile', () => {
    useGameStore.setState({ currentBiome: 'delta' });
    for (let i = 0; i < 10; i += 1) core.step();
    expect(getGameplayProfile().flowCap).toBe(1.0);
  });

  it('stops listening when unregistered', () => {
    off();
    gameEvents.emit('biome-change', { biome: 'delta', segmentIndex: 4 });
    expect(getGameplayProfile().flowCap).toBe(1.0);
  });

  it('blends in sim time across a boundary that asks for it, whatever the frame cadence', () => {
    const target = { ...resolveGameplayProfile('glacialMelt'), blendSec: 2 };
    // `frames` render frames of `frameDelta` seconds, twice over: 1 s, then 2 s of sim time.
    const run = (frameDelta: number, frames: number) => {
      resetGameplayProfileForTests();
      const c = new SimCore();
      const unregister = c.register(createGameplayProfileSimSystem());
      setGameplayProfileTarget(target);
      const samples: number[] = [];
      for (let i = 0; i < frames; i += 1) c.advance(frameDelta);
      samples.push(getGameplayProfile().flowCap);
      for (let i = 0; i < frames; i += 1) c.advance(frameDelta);
      samples.push(getGameplayProfile().flowCap);
      unregister();
      return samples;
    };
    const at60 = run(SIM_DT, 60);
    // 1 s of a 2 s blend from 1.0 to 1.85: half way.
    expect(at60[0]).toBeCloseTo(1.425, 3);
    expect(at60[1]).toBe(1.85);
    // 40 render frames of 25 ms are the same 60 steps, so the same profile.
    expect(run(0.025, 40)).toEqual(at60);
  });

  it('a run of steps with no change allocates no new profile (the live object is stable)', () => {
    const before = getGameplayProfile();
    gameEvents.emit('biome-change', { biome: 'glacier', segmentIndex: -3 });
    for (let i = 0; i < 5; i += 1) core.step();
    expect(getGameplayProfile()).toBe(before);
  });
});
