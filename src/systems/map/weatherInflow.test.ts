import { describe, expect, it } from 'vitest';
import {
  CLEAR_WEATHER,
  weatherFairnessKey,
  weatherFlowRateDelta,
  weatherHullScale,
  weatherSlushiness,
  type RunWeather,
} from './weatherInflow';
import { headDischargeAtHour } from '../../systems/water/riverRouter';
import { DEFAULT_FORECAST_INPUTS } from '../../constants/forecast';
import { hashHydroEvents, parseHydroEvents } from '../water/hydroEvents';
import { buildGhostHydroFairness } from '../ghost/hydroFairness';
import hydro from '../../maps/hydro_dam.json';
import { parseRunWeather, parseLaunchWeatherOverride } from '../../utils/launchWeatherOverride';

const STORM: RunWeather = { type: 'storm', intensity: 0.9 };
const RAIN: RunWeather = { type: 'rain', intensity: 0.7 };
const SNOW: RunWeather = { type: 'snow', intensity: 1 };
const FOG: RunWeather = { type: 'fog', intensity: 1 };

describe('weatherFlowRateDelta', () => {
  it('is exactly zero for clear, fog, snow and no weather', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      for (const weather of [undefined, null, CLEAR_WEATHER, FOG, SNOW]) {
        expect(weatherFlowRateDelta(hour, weather)).toBe(0);
      }
    }
  });

  it('rain and storm add water, storm more, and storm peaks in the afternoon', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const rain = weatherFlowRateDelta(hour, RAIN);
      const storm = weatherFlowRateDelta(hour, STORM);
      expect(rain).toBeGreaterThan(0);
      expect(storm).toBeGreaterThan(rain);
    }
    expect(weatherFlowRateDelta(15, STORM)).toBeGreaterThan(weatherFlowRateDelta(6, STORM));
  });

  it('scales with intensity and clamps it', () => {
    expect(weatherFlowRateDelta(14, { type: 'storm', intensity: 0 })).toBe(0);
    expect(weatherFlowRateDelta(14, { type: 'storm', intensity: 0.5 })).toBeCloseTo(
      weatherFlowRateDelta(14, { type: 'storm', intensity: 1 }) / 2,
    );
    expect(weatherFlowRateDelta(14, { type: 'storm', intensity: 7 })).toBe(
      weatherFlowRateDelta(14, { type: 'storm', intensity: 1 }),
    );
    expect(weatherFlowRateDelta(14, { type: 'storm', intensity: Number.NaN })).toBe(0);
  });
});

describe('headDischargeAtHour with weather (the router head)', () => {
  it('clear reproduces the pre-weather hydrograph bit for bit', () => {
    for (let hour = 0; hour < 24; hour += 0.5) {
      const base = headDischargeAtHour(hour);
      expect(headDischargeAtHour(hour, { ...DEFAULT_FORECAST_INPUTS, weather: CLEAR_WEATHER })).toBe(base);
      expect(headDischargeAtHour(hour, { ...DEFAULT_FORECAST_INPUTS, weather: null })).toBe(base);
    }
  });

  it('the same launch hour under storm carries more water than clear; snow does not', () => {
    for (const hour of [6, 14, 20]) {
      const clear = headDischargeAtHour(hour);
      expect(headDischargeAtHour(hour, { ...DEFAULT_FORECAST_INPUTS, weather: STORM })).toBeGreaterThan(clear);
      expect(headDischargeAtHour(hour, { ...DEFAULT_FORECAST_INPUTS, weather: SNOW })).toBe(clear);
    }
  });
});

describe('weatherHullScale / weatherSlushiness', () => {
  it('is identity for every weather but snow', () => {
    for (const weather of [undefined, CLEAR_WEATHER, FOG, RAIN, STORM]) {
      expect(weatherHullScale(weather)).toEqual({ flowCapScale: 1, dragScale: 1 });
      expect(weatherSlushiness(weather)).toBe(0);
    }
  });

  it('snow lowers the flow cap, raises drag and slushes the surface', () => {
    const hull = weatherHullScale(SNOW);
    expect(hull.flowCapScale).toBeLessThan(1);
    expect(hull.flowCapScale).toBeGreaterThan(0);
    expect(hull.dragScale).toBeGreaterThan(1);
    expect(weatherSlushiness(SNOW)).toBeGreaterThan(0);
  });
});

describe('ghost fairness under weather', () => {
  const events = parseHydroEvents(hydro.hydroEvents);

  it('a clear run hashes exactly as before weather existed', () => {
    expect(weatherFairnessKey(CLEAR_WEATHER)).toBe('');
    expect(weatherFairnessKey(FOG)).toBe('');
    expect(
      buildGhostHydroFairness({ launchHour: 14, events, qualityPreset: 'high', weather: CLEAR_WEATHER }).hydroEventHash,
    ).toBe(hashHydroEvents(events, 14));
  });

  it('storm and snow rivers hash apart from clear and from each other', () => {
    const clear = hashHydroEvents(events, 14);
    const storm = hashHydroEvents(events, 14, weatherFairnessKey(STORM));
    const snow = hashHydroEvents(events, 14, weatherFairnessKey(SNOW));
    expect(new Set([clear, storm, snow]).size).toBe(3);
  });
});

describe('?weather= override', () => {
  it('parses a type with an optional intensity', () => {
    expect(parseRunWeather('storm')).toEqual({ type: 'storm', intensity: 0.9 });
    expect(parseRunWeather('Snow:0.4')).toEqual({ type: 'snow', intensity: 0.4 });
    expect(parseRunWeather('rain:3')).toEqual({ type: 'rain', intensity: 1 });
    expect(parseRunWeather('hail')).toBeNull();
    expect(parseRunWeather('storm:x')).toBeNull();
    expect(parseLaunchWeatherOverride('?map=glacial&weather=storm')?.type).toBe('storm');
    expect(parseLaunchWeatherOverride('?map=glacial')).toBeNull();
  });
});
