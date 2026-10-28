import { beforeEach, describe, expect, it } from 'vitest';
import { WATER_LEVEL } from '../../constants/game';
import { SIM_DT, SimCore } from '../../sim/core/SimCore';
import { useGameStore } from '../GameState';
import {
  getActiveSurvivalState,
  initRunSession,
  resetRunSessionForTests,
  tickRunSurvival,
} from './runSession';
import { createSurvivalSimSystem, RUNNER_IN_WATER_MARGIN } from './survivalSystem';

function setup() {
  const core = new SimCore();
  core.register(createSurvivalSimSystem());
  core.ctx.vehicle.valid = true;
  core.ctx.vehicle.posOk = true;
  return core;
}

describe('survival sim system', () => {
  beforeEach(() => {
    resetRunSessionForTests();
    useGameStore.setState({ currentBiome: 'canyonSummer' });
    initRunSession({ mapId: 'meander', launchHour: 12 });
  });

  it('soaks a runner standing in the water, one step at a time', () => {
    const core = setup();
    core.ctx.vehicle.y = WATER_LEVEL;
    for (let i = 0; i < 60; i += 1) core.step();
    // 0.55 wetness per second in water (survivalState WETNESS_GAIN_IN_WATER).
    expect(getActiveSurvivalState()!.wetness).toBeCloseTo(0.55 * 60 * SIM_DT, 6);
  });

  it('dries a runner above the splash line', () => {
    const core = setup();
    core.ctx.vehicle.y = WATER_LEVEL;
    for (let i = 0; i < 120; i += 1) core.step();
    const wet = getActiveSurvivalState()!.wetness;
    core.ctx.vehicle.y = WATER_LEVEL + RUNNER_IN_WATER_MARGIN + 1;
    for (let i = 0; i < 60; i += 1) core.step();
    expect(getActiveSurvivalState()!.wetness).toBeLessThan(wet);
  });

  it('does nothing without a vehicle, or without a run', () => {
    const core = setup();
    core.ctx.vehicle.valid = false;
    core.ctx.vehicle.y = WATER_LEVEL;
    for (let i = 0; i < 30; i += 1) core.step();
    expect(getActiveSurvivalState()!.wetness).toBe(0);

    resetRunSessionForTests();
    core.ctx.vehicle.valid = true;
    expect(() => core.step()).not.toThrow();
    expect(getActiveSurvivalState()).toBeNull();
  });

  it('the raft\'s float, published through tickRunSurvival, is its inWater', () => {
    const core = setup();
    core.ctx.vehicle.isRaft = true;
    core.ctx.vehicle.y = WATER_LEVEL - 5; // a height test would say "in water"
    tickRunSurvival({ dt: 0.5, biomeId: 'canyonSummer', inWater: false, windSpeed: 0 });
    for (let i = 0; i < 30; i += 1) core.step();
    expect(getActiveSurvivalState()!.wetness).toBe(0);
    tickRunSurvival({ dt: 0.5, biomeId: 'canyonSummer', inWater: true, windSpeed: 0 });
    for (let i = 0; i < 30; i += 1) core.step();
    expect(getActiveSurvivalState()!.wetness).toBeGreaterThan(0.2);
  });

  it('tickRunSurvival no longer integrates: the vehicles\' calls cannot run time twice', () => {
    for (let i = 0; i < 100; i += 1) {
      tickRunSurvival({ dt: 1, biomeId: 'canyonSummer', inWater: true, windSpeed: 0 });
    }
    expect(getActiveSurvivalState()!.wetness).toBe(0);
    expect(tickRunSurvival({ dt: 1, biomeId: 'canyonSummer', inWater: true, windSpeed: 0 })).not.toBeNull();
  });
});
