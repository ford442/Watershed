import { afterEach, describe, expect, it } from 'vitest';
import { WEATHER_CONFIG } from '../../constants/weather';
import { normalizeWeatherScript, constantWeatherScript } from './weatherScript';
import {
  biomeAmbientWeather,
  blendWeather,
  continueWeatherDirector,
  createWeatherDirectorState,
  getDirectorRiverWeather,
  getDirectorVisualWeather,
  resetWeatherDirector,
  resetWeatherDirectorForTests,
  setWeatherDirectorAmbient,
  stepWeatherDirector,
  tickWeatherDirector,
  weatherBroadcastOf,
} from './weatherDirector';
import type { WeatherBroadcast } from '../GameState';

const SQUALL = normalizeWeatherScript([
  { atReachFraction: 0, weather: 'clear' },
  { atReachFraction: 0.4, weather: 'storm', intensity: 0.9, rampSeconds: 30, overSegment: 2 },
  { atReachFraction: 0.7, weather: 'clear', rampSeconds: 40 },
]);

const broadcast = (): WeatherBroadcast => ({ type: 'clear', intensity: 0, transition: 1, rippleStrength: 0 });

afterEach(() => resetWeatherDirectorForTests());

describe('blendWeather', () => {
  it('fades a weather out under its own type, in under the new one, and swaps directly', () => {
    const out = { type: 'clear' as const, intensity: 0 } as { type: string; intensity: number };
    expect(blendWeather({ type: 'rain', intensity: 0.8 }, { type: 'clear', intensity: 0 }, 0.5, out as never)).toEqual({ type: 'rain', intensity: 0.4 });
    expect(blendWeather({ type: 'rain', intensity: 0.8 }, { type: 'clear', intensity: 0 }, 1, out as never)).toEqual({ type: 'clear', intensity: 0 });
    expect(blendWeather({ type: 'clear', intensity: 0 }, { type: 'storm', intensity: 0.9 }, 0.5, out as never)).toEqual({ type: 'storm', intensity: 0.45 });
    expect(blendWeather({ type: 'rain', intensity: 0.7 }, { type: 'storm', intensity: 0.9 }, 0.5, out as never).type).toBe('storm');
    expect(blendWeather({ type: 'rain', intensity: 0.7 }, { type: 'storm', intensity: 0.9 }, 1, out as never).intensity).toBe(0.9);
  });
});

describe('stepWeatherDirector', () => {
  it('holds the launch weather until the step fraction, then ramps on sim time', () => {
    const state = createWeatherDirectorState(SQUALL);
    stepWeatherDirector(state, 0, 0);
    expect(state.river).toEqual({ type: 'clear', intensity: 0 });
    for (let i = 0; i < 600; i += 1) stepWeatherDirector(state, 0.3, 1 / 60);
    expect(state.river.type).toBe('clear');

    stepWeatherDirector(state, 0.4, 1 / 60);
    expect(state.stepIndex).toBe(1);
    expect(state.river.type).toBe('storm');
    expect(state.overSegment).toBe(2);
    const early = state.river.intensity;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.05);

    // 15 s in: half way up the smoothstep ramp.
    for (let i = 0; i < 899; i += 1) stepWeatherDirector(state, 0.45, 1 / 60);
    expect(state.river.intensity).toBeCloseTo(0.45, 1);
    for (let i = 0; i < 900; i += 1) stepWeatherDirector(state, 0.5, 1 / 60);
    expect(state.river).toEqual({ type: 'storm', intensity: 0.9 });

    // Clearing: the storm fades under its own type, then the head takes the river back.
    stepWeatherDirector(state, 0.7, 20);
    expect(state.river.type).toBe('storm');
    expect(state.river.intensity).toBeCloseTo(0.45, 5);
    expect(state.overSegment).toBeNull();
    stepWeatherDirector(state, 0.7, 20);
    expect(state.river).toEqual({ type: 'clear', intensity: 0 });
  });

  it('only moves forward: a respawn upstream keeps the weather that arrived', () => {
    const state = createWeatherDirectorState(SQUALL);
    stepWeatherDirector(state, 0.5, 60);
    expect(state.river).toEqual({ type: 'storm', intensity: 0.9 });
    stepWeatherDirector(state, 0.1, 1);
    expect(state.stepIndex).toBe(1);
    expect(state.river).toEqual({ type: 'storm', intensity: 0.9 });
  });

  it('is deterministic: two directors fed one frame sequence agree bit for bit', () => {
    const a = createWeatherDirectorState(SQUALL);
    const b = createWeatherDirectorState(SQUALL);
    const trace: number[] = [];
    for (let i = 0; i < 6000; i += 1) {
      const fraction = Math.min(1, i / 5000);
      stepWeatherDirector(a, fraction, 1 / 60);
      stepWeatherDirector(b, fraction, 1 / 60);
      trace.push(a.river.intensity);
      expect(b.river).toEqual(a.river);
    }
    // The squall builds for 25 s before the clearing step lands, then fades out.
    expect(Math.max(...trace)).toBeGreaterThan(0.8);
    expect(a.river).toEqual({ type: 'clear', intensity: 0 });
  });
});

describe('the run director', () => {
  it('takes step 0 at reset, so the river reads the launch weather before the first frame', () => {
    resetWeatherDirector(constantWeatherScript({ type: 'storm', intensity: 0.9 }));
    expect(getDirectorRiverWeather()).toEqual({ type: 'storm', intensity: 0.9 });
  });

  it('shows ambient weather (glacial snow, a reach manifest) only while the river is clear', () => {
    resetWeatherDirector(SQUALL);
    setWeatherDirectorAmbient(biomeAmbientWeather('glacialMelt'));
    expect(getDirectorVisualWeather()).toEqual({ type: 'snow', intensity: 0.65 });
    // Ambient never touches the river.
    expect(getDirectorRiverWeather()).toEqual({ type: 'clear', intensity: 0 });
    tickWeatherDirector(0.5, 60);
    expect(getDirectorVisualWeather()).toEqual({ type: 'storm', intensity: 0.9 });
    expect(biomeAmbientWeather('canyonSummer')).toBeNull();
  });

  it('carries the river across a journey handoff into the next map script', () => {
    resetWeatherDirector(constantWeatherScript({ type: 'rain', intensity: 0.7 }));
    continueWeatherDirector(normalizeWeatherScript([{ atReachFraction: 0, weather: 'clear', rampSeconds: 10 }]));
    expect(getDirectorRiverWeather()).toEqual({ type: 'rain', intensity: 0.7 });
    tickWeatherDirector(0, 5);
    expect(getDirectorRiverWeather().type).toBe('rain');
    expect(getDirectorRiverWeather().intensity).toBeCloseTo(0.35, 5);
    tickWeatherDirector(0, 5);
    expect(getDirectorRiverWeather()).toEqual({ type: 'clear', intensity: 0 });
  });
});

describe('weatherBroadcastOf', () => {
  it('writes the biome rule shape for ambient snow and a ramped ripple for a squall', () => {
    const state = createWeatherDirectorState(SQUALL);
    stepWeatherDirector(state, 0, 0);
    state.ambient = { type: 'snow', intensity: 0.65 };
    expect(weatherBroadcastOf(state, broadcast())).toEqual({ type: 'snow', intensity: 0.65, transition: 1, rippleStrength: 0 });

    state.ambient = null;
    expect(weatherBroadcastOf(state, broadcast())).toEqual({ type: 'clear', intensity: 0, transition: 1, rippleStrength: 0 });

    stepWeatherDirector(state, 0.4, 15);
    const mid = weatherBroadcastOf(state, broadcast());
    expect(mid.type).toBe('storm');
    expect(mid.transition).toBeCloseTo(0.45, 5);
    expect(mid.rippleStrength).toBeCloseTo(WEATHER_CONFIG.water.stormRippleStrength / 2, 5);
    stepWeatherDirector(state, 0.4, 30);
    expect(weatherBroadcastOf(state, broadcast()).rippleStrength).toBe(WEATHER_CONFIG.water.stormRippleStrength);
  });

  it('calms the ripple across a clearing ramp instead of dropping it at the end', () => {
    const state = createWeatherDirectorState(SQUALL);
    stepWeatherDirector(state, 0.4, 0);
    stepWeatherDirector(state, 0.4, 30);
    const full = WEATHER_CONFIG.water.stormRippleStrength;
    expect(weatherBroadcastOf(state, broadcast()).rippleStrength).toBe(full);
    // The clear step takes 40 s; halfway the storm is half-faded, and so is the ripple.
    stepWeatherDirector(state, 0.7, 0);
    stepWeatherDirector(state, 0.7, 20);
    const mid = weatherBroadcastOf(state, broadcast());
    expect(mid.type).toBe('storm');
    expect(mid.rippleStrength).toBeGreaterThan(0.3 * full);
    expect(mid.rippleStrength).toBeLessThan(0.7 * full);
  });
});
