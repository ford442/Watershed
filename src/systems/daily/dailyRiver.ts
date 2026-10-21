/**
 * dailyRiver.ts — Today's River: one river per UTC day, the same for everyone.
 *
 * At 00:00 UTC the day's river is `hash(date)`: a map, a launch hour, a
 * weather script (clear, a squall over one reach, morning fog, showers that
 * clear, weather that builds) and the forecast's melt inputs. Everything is
 * drawn from named sub-streams of that one seed, so two clients on the same
 * date build the same river without talking to anything — there is no server.
 *
 * Pure: no React, no persistence, no wall clock beyond the `Date` passed in.
 */
import { listMapsForMenu } from '../../maps/campaign';
import { getMapDefinition, type MapRegistryId } from '../../maps/registry';
import { fnv1a32 } from '../../math/hash';
import { createRng, forkSeed, rngInt, rngRange, type Rng } from '../../math/random';
import type { RunConditions } from '../journey/runSession';
import { segmentAtReachFraction } from '../weather/reachFraction';
import { normalizeWeatherScript, type WeatherScript } from '../weather/weatherScript';

export interface DailyRiver {
  /** UTC date, `YYYY-MM-DD`. */
  dateKey: string;
  seed: number;
  mapId: MapRegistryId;
  launchHour: number;
  /** One word for the weather script, for the menu. */
  pattern: DailyWeatherPattern;
  conditions: RunConditions;
}

export type DailyWeatherPattern = 'clear' | 'squall' | 'showers' | 'building' | 'fog' | 'flurries';

/** Earliest and latest launch hours a day can pick (the canyon is lit). */
export const DAILY_LAUNCH_HOURS = { min: 5, max: 17 } as const;

const PATTERN_WEIGHTS: ReadonlyArray<[DailyWeatherPattern, number]> = [
  ['clear', 0.3],
  ['squall', 0.25],
  ['showers', 0.15],
  ['building', 0.15],
  ['fog', 0.1],
  ['flurries', 0.05],
];

/** `YYYY-MM-DD` of `now` in UTC — the day's key everywhere (seed, persistence, fairness). */
export function dailyDateKey(now: Date | number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The day's seed. */
export function dailySeed(dateKey: string): number {
  return fnv1a32(`watershed-daily:${dateKey}`);
}

function pickPattern(rng: Rng): DailyWeatherPattern {
  let roll = rng();
  for (const [pattern, weight] of PATTERN_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return pattern;
  }
  return 'clear';
}

const round = (value: number, places: number) => Number(value.toFixed(places));

function weatherScriptFor(pattern: DailyWeatherPattern, rng: Rng, mapId: MapRegistryId): WeatherScript {
  const map = getMapDefinition(mapId);
  const at = (min: number, max: number) => round(rngRange(rng, min, max), 3);
  const ramp = (min: number, max: number) => Math.round(rngRange(rng, min, max));
  const strength = (min: number, max: number) => round(rngRange(rng, min, max), 2);
  switch (pattern) {
    case 'squall': {
      // Clear, then a squall that sits over one reach of the map, then clearing.
      const arrives = at(0.25, 0.45);
      const clears = round(Math.min(0.95, arrives + rngRange(rng, 0.2, 0.3)), 3);
      return normalizeWeatherScript([
        { atReachFraction: 0, weather: 'clear' },
        {
          atReachFraction: arrives,
          weather: 'storm',
          intensity: strength(0.75, 0.95),
          rampSeconds: ramp(25, 45),
          overSegment: segmentAtReachFraction(map, Math.min(1, arrives + 0.1)),
        },
        { atReachFraction: clears, weather: 'clear', rampSeconds: ramp(40, 70) },
      ]);
    }
    case 'showers':
      return normalizeWeatherScript([
        { atReachFraction: 0, weather: 'rain', intensity: strength(0.5, 0.8) },
        { atReachFraction: at(0.4, 0.7), weather: 'clear', rampSeconds: ramp(45, 75) },
      ]);
    case 'building':
      return normalizeWeatherScript([
        { atReachFraction: 0, weather: 'clear' },
        { atReachFraction: at(0.2, 0.4), weather: 'rain', intensity: strength(0.5, 0.7), rampSeconds: ramp(25, 40) },
        { atReachFraction: at(0.55, 0.75), weather: 'storm', intensity: strength(0.8, 0.95), rampSeconds: ramp(25, 40) },
      ]);
    case 'fog':
      return normalizeWeatherScript([
        { atReachFraction: 0, weather: 'fog', intensity: strength(0.5, 0.7) },
        { atReachFraction: at(0.3, 0.5), weather: 'clear', rampSeconds: ramp(30, 60) },
      ]);
    case 'flurries':
      return normalizeWeatherScript([
        { atReachFraction: 0, weather: 'clear' },
        { atReachFraction: at(0.3, 0.5), weather: 'snow', intensity: strength(0.45, 0.7), rampSeconds: ramp(30, 50) },
        { atReachFraction: at(0.75, 0.9), weather: 'clear', rampSeconds: ramp(40, 70) },
      ]);
    case 'clear':
    default:
      return normalizeWeatherScript([{ atReachFraction: 0, weather: 'clear' }]);
  }
}

/** Today's River for `dateKey` (`dailyDateKey()` by default). Same input, same river. */
export function dailyRiverFor(dateKey: string = dailyDateKey()): DailyRiver {
  const seed = dailySeed(dateKey);
  const maps = listMapsForMenu().map((m) => m.id);
  const mapRng = createRng(forkSeed(seed, 'map'));
  const mapId = maps[rngInt(mapRng, 0, maps.length - 1)] ?? 'meander';
  const launchHour = rngInt(createRng(forkSeed(seed, 'hour')), DAILY_LAUNCH_HOURS.min, DAILY_LAUNCH_HOURS.max);
  const weatherRng = createRng(forkSeed(seed, 'weather'));
  const pattern = pickPattern(weatherRng);
  const weatherScript = weatherScriptFor(pattern, weatherRng, mapId);
  const meltRng = createRng(forkSeed(seed, 'melt'));
  const temperature = round(rngRange(meltRng, mapId === 'glacial' ? 0 : 4, mapId === 'glacial' ? 10 : 16), 1);
  const snowpackIndex = round(rngRange(meltRng, 0.3, 0.95), 2);
  return {
    dateKey,
    seed,
    mapId,
    launchHour,
    pattern,
    conditions: { weatherScript, temperature, snowpackIndex, dailyKey: dateKey },
  };
}
