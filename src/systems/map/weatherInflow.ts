/**
 * weatherInflow — the run's weather as a boundary condition on the river (#464).
 *
 * Weather does not get a solver. Rain and storm add discharge at the head of
 * the routed chain (riverRouter.headDischargeAtHour), which the router carries
 * down with its travel time and rates as the SWE window's upstream `edgeEta` —
 * the same path a 14:00 dam release takes. Snow adds no discharge: it thickens
 * the water the hull is already in (a lower flow cap, more drag) and turns the
 * surface to slush through the `slushiness` uniform that already exists.
 *
 * Clear (and fog) are exactly zero / identity, so a clear run reproduces the
 * pre-weather numbers bit for bit (the hydroContrast fixtures stay put).
 *
 * Pure and leaf-level (type-only imports) so the sim worker's router reads it.
 */
import type { WeatherType } from '../../constants/weather';

export interface RunWeather {
  type: WeatherType;
  /** 0..1 — how hard it is coming down. */
  intensity: number;
}

export const CLEAR_WEATHER: Readonly<RunWeather> = Object.freeze({ type: 'clear', intensity: 0 });

/** Default intensity when a weather is picked without one (launch picker, `?weather=storm`). */
export const DEFAULT_WEATHER_INTENSITY: Readonly<Record<WeatherType, number>> = {
  clear: 0,
  fog: 0.6,
  rain: 0.7,
  storm: 0.9,
  snow: 0.65,
};

/**
 * Head `flowRate` added at full intensity. For scale, the 14:00 dam release is
 * +0.35 on a ~1.36 baseline — a full storm is about that big, rain about a third.
 */
export const WEATHER_FLOW_RATE_GAIN = {
  rain: 0.12,
  storm: 0.3,
} as const;

/** Extra storm runoff around the afternoon convective peak (hour, half-width h, gain). */
export const STORM_CONVECTIVE_PEAK = { hour: 15, halfWidth: 3, gain: 0.1 } as const;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

/**
 * Additive head `flowRate` for the weather at `hour`. Zero for clear, fog,
 * snow and an absent weather — only rain and storm add water.
 */
export function weatherFlowRateDelta(hour: number, weather: RunWeather | null | undefined): number {
  if (!weather) return 0;
  const intensity = clamp01(weather.intensity);
  if (intensity === 0) return 0;
  if (weather.type === 'rain') return WEATHER_FLOW_RATE_GAIN.rain * intensity;
  if (weather.type === 'storm') {
    const h = wrapHour(hour);
    const d = Math.min(Math.abs(h - STORM_CONVECTIVE_PEAK.hour), 24 - Math.abs(h - STORM_CONVECTIVE_PEAK.hour));
    const peak = Math.max(0, 1 - d / STORM_CONVECTIVE_PEAK.halfWidth);
    return (WEATHER_FLOW_RATE_GAIN.storm + STORM_CONVECTIVE_PEAK.gain * peak) * intensity;
  }
  return 0;
}

export interface WeatherHullScale {
  /** Multiplies the hull sample's flow-speed cap (sampleSWEFlow `flowSpeed`). */
  flowCapScale: number;
  /** Multiplies the hull's drag coefficient. */
  dragScale: number;
}

const IDENTITY_HULL: Readonly<WeatherHullScale> = Object.freeze({ flowCapScale: 1, dragScale: 1 });

/** Snow at full intensity: slush runs ~20% slower and grabs the hull ~35% harder. */
export const SNOW_HULL = { flowCapLoss: 0.2, dragGain: 0.35 } as const;

/** How the weather changes the water the hull sits in. Identity except for snow. */
export function weatherHullScale(weather: RunWeather | null | undefined): Readonly<WeatherHullScale> {
  if (!weather || weather.type !== 'snow') return IDENTITY_HULL;
  const intensity = clamp01(weather.intensity);
  if (intensity === 0) return IDENTITY_HULL;
  return {
    flowCapScale: 1 - SNOW_HULL.flowCapLoss * intensity,
    dragScale: 1 + SNOW_HULL.dragGain * intensity,
  };
}

/** Surface slush the water material takes from the weather (0 except for snow). */
export function weatherSlushiness(weather: RunWeather | null | undefined): number {
  if (!weather || weather.type !== 'snow') return 0;
  return 0.6 * clamp01(weather.intensity);
}

/** True when the weather changes the river (discharge or hull), i.e. a ghost must not cross it. */
export function weatherAffectsRiver(weather: RunWeather | null | undefined): boolean {
  return weatherFlowRateDelta(STORM_CONVECTIVE_PEAK.hour, weather) !== 0 || weatherHullScale(weather) !== IDENTITY_HULL;
}

/** Stable key for ghost fairness, or '' when the weather leaves the river as clear. */
export function weatherFairnessKey(weather: RunWeather | null | undefined): string {
  if (!weather || !weatherAffectsRiver(weather)) return '';
  return `${weather.type}@${clamp01(weather.intensity).toFixed(2)}`;
}
