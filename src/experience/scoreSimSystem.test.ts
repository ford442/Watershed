import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebugStageController } from '../debug/debugStages';
import { SIM_DT, SimCore } from '../sim/core/SimCore';
import { useGameStore } from '../systems/GameState';
import {
  GHOST_SAMPLE_INTERVAL,
  getGhostSampleCount,
  resetGhostRecording,
  startGhostRecording,
} from '../systems/ghost/GhostRecorder';
import { resetScoreSystemState } from '../systems/score/ScoreSystem';
import { createScoreSimSystem } from './scoreSimSystem';

function setup(enabled = true) {
  const debug = {
    isStageEnabled: () => enabled,
    setStageFailure: vi.fn(),
  } as unknown as DebugStageController;
  const core = new SimCore();
  core.register(createScoreSimSystem(debug));
  const v = core.ctx.vehicle;
  v.valid = true;
  v.posOk = true;
  v.vz = -20;
  return { core, v, debug };
}

describe('score sim system', () => {
  beforeEach(() => {
    resetScoreSystemState();
    resetGhostRecording();
    useGameStore.setState({ isPaused: false, isWipeout: false });
  });

  it('accrues score at speed × dt per fixed step', () => {
    const { core } = setup();
    const before = useGameStore.getState().score;
    for (let i = 0; i < 60; i += 1) core.step();
    expect(useGameStore.getState().score - before).toBeCloseTo(20 * 60 * SIM_DT, 3);
  });

  it('writes one ghost sample per GHOST_SAMPLE_INTERVAL of sim time, however the frames fall', () => {
    startGhostRecording();
    const { core } = setup();
    for (let i = 0; i < 90; i += 1) core.advance(0.025);
    const steps = core.ctx.stepIndex;
    expect(getGhostSampleCount()).toBe(Math.floor((steps * SIM_DT + 1e-9) / GHOST_SAMPLE_INTERVAL));
  });

  it('records nothing while paused or wiped out, or with a non-finite position', () => {
    startGhostRecording();
    const { core, v } = setup();
    useGameStore.setState({ isPaused: true });
    for (let i = 0; i < 60; i += 1) core.step();
    useGameStore.setState({ isPaused: false, isWipeout: true });
    for (let i = 0; i < 60; i += 1) core.step();
    useGameStore.setState({ isWipeout: false });
    v.posOk = false;
    for (let i = 0; i < 60; i += 1) core.step();
    expect(getGhostSampleCount()).toBe(0);
  });

  it('does nothing without a vehicle or with the stateManagement stage off', () => {
    startGhostRecording();
    const noVehicle = setup();
    noVehicle.v.valid = false;
    for (let i = 0; i < 60; i += 1) noVehicle.core.step();
    const off = setup(false);
    for (let i = 0; i < 60; i += 1) off.core.step();
    expect(getGhostSampleCount()).toBe(0);
  });
});
