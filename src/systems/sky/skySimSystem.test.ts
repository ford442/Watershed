import { afterEach, describe, expect, it } from 'vitest';
import { SIM_DT, SimCore } from '../../sim/core/SimCore';
import { getMapAtmosphere } from '../../maps/atmosphere';
import { useGameStore } from '../GameState';
import { getSkyClock, resetSkyClock, resetSkyClockForTests } from './skyClock';
import { createSkySimSystem } from './skySimSystem';

afterEach(() => {
  resetSkyClockForTests();
  useGameStore.setState({ isPaused: false });
});

describe('sky-clock sim system', () => {
  it('advances the clock by sim seconds, whatever the render frame deltas were', () => {
    resetSkyClock(6, getMapAtmosphere('glacial'));
    const core = new SimCore();
    core.register(createSkySimSystem());
    const start = getSkyClock().hour;
    // 90 uneven render frames of 25 ms = 2.25 s of sim time = 135 steps.
    for (let i = 0; i < 90; i += 1) core.advance(0.025);
    expect(core.ctx.stepIndex).toBe(135);

    resetSkyClock(6, getMapAtmosphere('glacial'));
    const ref = new SimCore();
    ref.register(createSkySimSystem());
    for (let i = 0; i < 135; i += 1) ref.advance(SIM_DT);
    expect(getSkyClock().hour).toBeGreaterThan(start);
    // Same steps, same hour: the render cadence is not in the answer.
    const hourA = getSkyClock().hour;
    resetSkyClock(6, getMapAtmosphere('glacial'));
    const again = new SimCore();
    again.register(createSkySimSystem());
    for (let i = 0; i < 90; i += 1) again.advance(0.025);
    expect(getSkyClock().hour).toBe(hourA);
  });

  it('holds the clock while paused', () => {
    resetSkyClock(6, getMapAtmosphere('glacial'));
    useGameStore.setState({ isPaused: true });
    const core = new SimCore();
    core.register(createSkySimSystem());
    const hour = getSkyClock().hour;
    for (let i = 0; i < 60; i += 1) core.step();
    expect(getSkyClock().hour).toBe(hour);
  });
});
