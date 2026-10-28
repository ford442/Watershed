import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SIM_DT, SimCore } from '../../sim/core/SimCore';
import { useGameStore } from '../GameState';
import { normalizeWeatherScript } from './weatherScript';
import {
  getDirectorRiverWeather,
  getWeatherDirector,
  resetWeatherDirector,
  resetWeatherDirectorForTests,
} from './weatherDirector';
import { createWeatherSimSystem } from './weatherSimSystem';

const SHOWER = normalizeWeatherScript([
  { atReachFraction: 0, weather: 'clear' },
  { atReachFraction: 0, weather: 'rain', intensity: 0.8, rampSeconds: 10 },
]);

describe('weather-director sim system', () => {
  let core: SimCore;
  beforeEach(() => {
    core = new SimCore();
    core.register(createWeatherSimSystem());
    useGameStore.setState({ isPaused: false });
    resetWeatherDirector(SHOWER);
  });
  afterEach(() => {
    resetWeatherDirectorForTests();
    useGameStore.setState({ isPaused: false });
  });

  it('steps the director on sim time, one fixed step at a time', () => {
    const before = getWeatherDirector().elapsed;
    for (let i = 0; i < 60; i += 1) core.step();
    expect(getWeatherDirector().elapsed - before).toBeCloseTo(60 * SIM_DT, 9);
    expect(getDirectorRiverWeather().type).toBe('rain');
  });

  it('holds the director while the game is paused', () => {
    useGameStore.setState({ isPaused: true });
    const before = getWeatherDirector().elapsed;
    for (let i = 0; i < 30; i += 1) core.step();
    expect(getWeatherDirector().elapsed).toBe(before);
  });

  it('publishes the visual weather to the store as the ramp moves', () => {
    for (let i = 0; i < 300; i += 1) core.step();
    const weather = useGameStore.getState().weather;
    expect(weather.type).toBe('rain');
    expect(weather.intensity).toBeGreaterThan(0.1);
  });

  it('is deterministic: two cores over one script publish the same weather', () => {
    const run = () => {
      resetWeatherDirector(SHOWER);
      const c = new SimCore();
      c.register(createWeatherSimSystem());
      for (let i = 0; i < 421; i += 1) c.step();
      return { ...getDirectorRiverWeather() };
    };
    expect(run()).toEqual(run());
  });
});
