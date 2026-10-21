/**
 * weatherScript.ts — a run's weather as data: what arrives where, and how fast.
 *
 * A script is a list of steps keyed by how far down the map the player is
 * (`atReachFraction`, 0 = the map's first authored segment, 1 = past its last).
 * Each step names a weather, its intensity, how long (sim seconds) the change
 * takes, and optionally the routed chain segment the weather sits over — a
 * squall over reach 2 feeds the river at reach 2 (lateral inflow), not at the
 * head.
 *
 * The launch picker's choice is the one-step script `constantWeatherScript`;
 * the Daily River generates longer ones (`dailyRiver.ts`). WeatherDirector is
 * the only reader that turns a script into weather.
 *
 * Pure and leaf-level (type-only imports beyond math) so the sim worker and
 * the persistence layer can read it.
 */
import type { WeatherType } from '../../constants/weather';
import { clamp01 } from '../../math/scalar';
import {
  CLEAR_WEATHER,
  DEFAULT_WEATHER_INTENSITY,
  weatherAffectsRiver,
  weatherFairnessKey,
  type RunWeather,
} from '../map/weatherInflow';

export interface WeatherScriptStep {
  /** Map progress (0..1) at which this step starts. Steps are sorted by it. */
  atReachFraction: number;
  weather: WeatherType;
  /** 0..1; defaults to `DEFAULT_WEATHER_INTENSITY[weather]`. */
  intensity: number;
  /** Sim seconds from the previous weather to this one (0 = immediate). */
  rampSeconds: number;
  /**
   * Routed chain segment the weather sits over (lateral inflow). Absent = the
   * head of the chain, which is how a launch weather has always fed the river.
   */
  overChainIndex?: number;
}

export type WeatherScript = readonly WeatherScriptStep[];

const WEATHER_TYPES: ReadonlySet<string> = new Set<WeatherType>(['clear', 'rain', 'fog', 'storm', 'snow']);

/** True for a known weather type. */
export function isWeatherType(value: unknown): value is WeatherType {
  return typeof value === 'string' && WEATHER_TYPES.has(value);
}

/** The launch weather as a script: one step, in force from the first frame. */
export function constantWeatherScript(weather: RunWeather = CLEAR_WEATHER): WeatherScript {
  return [{ atReachFraction: 0, weather: weather.type, intensity: clamp01(weather.intensity), rampSeconds: 0 }];
}

/**
 * Validate and normalise a script: unknown types dropped, fractions and
 * intensities clamped, ramps non-negative, sorted by fraction, and a clear
 * step at 0 prepended when the first step starts later (the run has to start
 * in some weather). Never throws; an unusable input is the clear script.
 */
export function normalizeWeatherScript(raw: unknown): WeatherScript {
  if (!Array.isArray(raw)) return constantWeatherScript();
  const steps: WeatherScriptStep[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!isWeatherType(e.weather)) continue;
    const at = Number(e.atReachFraction ?? 0);
    const intensity = e.intensity === undefined ? DEFAULT_WEATHER_INTENSITY[e.weather] : Number(e.intensity);
    const ramp = Number(e.rampSeconds ?? 0);
    if (!Number.isFinite(at) || !Number.isFinite(intensity) || !Number.isFinite(ramp)) continue;
    const step: WeatherScriptStep = {
      atReachFraction: clamp01(at),
      weather: e.weather,
      intensity: e.weather === 'clear' ? 0 : clamp01(intensity),
      rampSeconds: Math.max(0, ramp),
    };
    const over = Number(e.overChainIndex);
    if (e.overChainIndex !== undefined && Number.isInteger(over) && over >= 0) step.overChainIndex = over;
    steps.push(step);
  }
  if (steps.length === 0) return constantWeatherScript();
  // Stable sort: two steps at one fraction keep their authored order.
  steps.sort((a, b) => a.atReachFraction - b.atReachFraction);
  if (steps[0].atReachFraction > 0) steps.unshift({ atReachFraction: 0, weather: 'clear', intensity: 0, rampSeconds: 0 });
  return steps;
}

/** A step's weather as the river sees it. */
export function stepWeather(step: WeatherScriptStep): RunWeather {
  return { type: step.weather, intensity: step.intensity };
}

/** The weather in force at launch (step 0) — what the router spins up on. */
export function launchWeatherOf(script: WeatherScript): RunWeather {
  return script.length > 0 ? stepWeather(script[0]) : CLEAR_WEATHER;
}

/** True when any step is something other than clear — the scene then needs a WeatherSystem. */
export function weatherScriptHasWeather(script: WeatherScript): boolean {
  return script.some((step) => step.weather !== 'clear' && step.intensity > 0);
}

/** True when any step changes the river (discharge or hull), i.e. a ghost must not cross it. */
export function weatherScriptAffectsRiver(script: WeatherScript): boolean {
  return script.some((step) => weatherAffectsRiver(stepWeather(step)));
}

/**
 * Ghost fairness key. A one-step script keys exactly as its weather always
 * did (`storm@0.90`, '' for a river-neutral weather), so pre-script ghosts
 * still match; a multi-step script keys every river-relevant step.
 */
export function weatherScriptFairnessKey(script: WeatherScript): string {
  if (!weatherScriptAffectsRiver(script)) return '';
  if (script.length === 1) return weatherFairnessKey(stepWeather(script[0]));
  return script
    .map((step) => {
      const at = step.atReachFraction.toFixed(3);
      const over = step.overChainIndex === undefined ? '' : `>${step.overChainIndex}`;
      const key = weatherFairnessKey(stepWeather(step)) || 'clear';
      return `${at}:${key}~${step.rampSeconds.toFixed(1)}${over}`;
    })
    .join('|');
}
