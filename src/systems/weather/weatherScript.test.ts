import { describe, expect, it } from 'vitest';
import { weatherFairnessKey } from '../map/weatherInflow';
import {
  constantWeatherScript,
  launchWeatherOf,
  normalizeWeatherScript,
  weatherScriptAffectsRiver,
  weatherScriptFairnessKey,
  weatherScriptHasWeather,
} from './weatherScript';

describe('normalizeWeatherScript', () => {
  it('sorts by fraction, clamps, drops unknown types and fills defaults', () => {
    const script = normalizeWeatherScript([
      { atReachFraction: 0.6, weather: 'clear', rampSeconds: 20 },
      { atReachFraction: 1.4, weather: 'rain', intensity: 2 },
      { atReachFraction: 0, weather: 'storm', rampSeconds: -3 },
      { atReachFraction: 0.3, weather: 'hail' },
      { atReachFraction: 0.2, weather: 'fog', overChainIndex: 2 },
    ]);
    expect(script.map((s) => s.weather)).toEqual(['storm', 'fog', 'clear', 'rain']);
    expect(script[0]).toEqual({ atReachFraction: 0, weather: 'storm', intensity: 0.9, rampSeconds: 0 });
    expect(script[1].overChainIndex).toBe(2);
    expect(script[2].intensity).toBe(0);
    expect(script[3]).toEqual({ atReachFraction: 1, weather: 'rain', intensity: 1, rampSeconds: 0 });
  });

  it('starts every script in some weather: clear at 0 when the first step is later', () => {
    const script = normalizeWeatherScript([{ atReachFraction: 0.4, weather: 'storm', rampSeconds: 30 }]);
    expect(script[0]).toEqual({ atReachFraction: 0, weather: 'clear', intensity: 0, rampSeconds: 0 });
    expect(launchWeatherOf(script)).toEqual({ type: 'clear', intensity: 0 });
  });

  it('turns anything unusable into the clear script', () => {
    expect(normalizeWeatherScript(null)).toEqual(constantWeatherScript());
    expect(normalizeWeatherScript([{ weather: 42 }])).toEqual(constantWeatherScript());
  });
});

describe('weather script keys', () => {
  it('a one-step script keys exactly as its weather always did', () => {
    for (const weather of [
      { type: 'clear' as const, intensity: 0 },
      { type: 'fog' as const, intensity: 0.6 },
      { type: 'storm' as const, intensity: 0.9 },
      { type: 'snow' as const, intensity: 0.65 },
    ]) {
      expect(weatherScriptFairnessKey(constantWeatherScript(weather))).toBe(weatherFairnessKey(weather));
    }
  });

  it('a squall mid-map keys apart from the same storm at launch and from a squall elsewhere', () => {
    const atLaunch = constantWeatherScript({ type: 'storm', intensity: 0.9 });
    const squall = normalizeWeatherScript([
      { atReachFraction: 0, weather: 'clear' },
      { atReachFraction: 0.4, weather: 'storm', intensity: 0.9, rampSeconds: 30, overChainIndex: 2 },
      { atReachFraction: 0.7, weather: 'clear', rampSeconds: 40 },
    ]);
    const elsewhere = normalizeWeatherScript([
      { atReachFraction: 0, weather: 'clear' },
      { atReachFraction: 0.4, weather: 'storm', intensity: 0.9, rampSeconds: 30, overChainIndex: 3 },
      { atReachFraction: 0.7, weather: 'clear', rampSeconds: 40 },
    ]);
    const keys = new Set([atLaunch, squall, elsewhere].map(weatherScriptFairnessKey));
    expect(keys.size).toBe(3);
    expect(weatherScriptAffectsRiver(squall)).toBe(true);
  });

  it('fog-only scripts show weather but leave the river (and the key) as clear', () => {
    const fog = normalizeWeatherScript([{ atReachFraction: 0.5, weather: 'fog', rampSeconds: 10 }]);
    expect(weatherScriptHasWeather(fog)).toBe(true);
    expect(weatherScriptAffectsRiver(fog)).toBe(false);
    expect(weatherScriptFairnessKey(fog)).toBe('');
    expect(weatherScriptHasWeather(constantWeatherScript())).toBe(false);
  });
});
