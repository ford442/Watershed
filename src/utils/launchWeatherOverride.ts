/**
 * launchWeatherOverride — `?weather=storm` / `?weather=snow:0.4` for scouting
 * and smoke (#464), the weather twin of `?hour=` (launchHourOverride.ts).
 * Read-only: it never writes persistence.
 */
import type { WeatherType } from '../constants/weather';
import { DEFAULT_WEATHER_INTENSITY, type RunWeather } from '../systems/map/weatherInflow';

const WEATHER_PARAM = 'weather';
export const RUN_WEATHER_TYPES: readonly WeatherType[] = ['clear', 'rain', 'fog', 'storm', 'snow'];

export function isWeatherType(value: unknown): value is WeatherType {
  return typeof value === 'string' && (RUN_WEATHER_TYPES as readonly string[]).includes(value);
}

/** `storm`, `storm:0.8` → RunWeather; null when absent or malformed. */
export function parseRunWeather(raw: string | null | undefined): RunWeather | null {
  if (!raw) return null;
  const [type, intensityRaw] = raw.trim().toLowerCase().split(':');
  if (!isWeatherType(type)) return null;
  if (intensityRaw === undefined || intensityRaw === '') {
    return { type, intensity: DEFAULT_WEATHER_INTENSITY[type] };
  }
  const intensity = Number(intensityRaw);
  if (!Number.isFinite(intensity)) return null;
  return { type, intensity: Math.min(1, Math.max(0, intensity)) };
}

/** Parse a weather override from a query string; null when absent or malformed. */
export function parseLaunchWeatherOverride(search?: string): RunWeather | null {
  const raw = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (!raw) return null;
  try {
    return parseRunWeather(new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`).get(WEATHER_PARAM));
  } catch {
    return null;
  }
}

/** Live override for this page load, or null. */
export function launchWeatherOverride(): RunWeather | null {
  return parseLaunchWeatherOverride();
}
