/**
 * weatherDirector.ts — the one owner of the run's weather.
 *
 * The run carries a weather script (weatherScript.ts). The director steps it on
 * the sim clock — `dtSec` from the frame that advanced the sim, never wall time
 * — against how far down the map the player is, and produces two weathers:
 *
 *   river   what the water sees: the router's discharge (head, or the step's
 *           chain segment), the hull's snow drag, the surface slush. Only the
 *           script feeds it, so a scripted replay routes the same river.
 *   visual  what the scene shows: the river weather when it is not clear,
 *           else the ambient one (a reach manifest's weather, or the glacial
 *           biomes' snow). Ambient weather never touches the water — exactly
 *           the old biome rule, which this replaces.
 *
 * The visual weather is published to the store's `weather` slice; WeatherSystem
 * renders it, everything else subscribes to the slice. Nothing here posts a
 * window event, and nothing else writes the slice.
 *
 * Steps only ever advance: a respawn upstream does not bring yesterday's sky
 * back. The state is one module-level object mutated in place, so a per-frame
 * step allocates nothing.
 */
import type { WeatherType } from '../../constants/weather';
import { WEATHER_CONFIG } from '../../constants/weather';
import { clamp01, lerp, smoothstep } from '../../math/scalar';
import { CLEAR_WEATHER, type RunWeather } from '../map/weatherInflow';
import type { WeatherBroadcast } from '../GameState';
import { constantWeatherScript, type WeatherScript } from './weatherScript';

/** Intensity of the glacial biomes' ambient snow (visual only). */
export const GLACIAL_AMBIENT_SNOW = 0.65;

export interface WeatherDirectorState {
  script: WeatherScript;
  /** Index of the latest step reached; −1 before the first frame. */
  stepIndex: number;
  /** River weather when the current ramp began. */
  from: RunWeather;
  /** Sim seconds into the current ramp. */
  rampElapsed: number;
  /** Sim seconds the director has run. */
  elapsed: number;
  /** The river's weather this frame (mutated in place). */
  river: RunWeather;
  /** Map segment the river weather sits over; null = the head of the chain. */
  overSegment: number | null;
  /** Ambient (visual-only) weather, or null. */
  ambient: RunWeather | null;
}

export function createWeatherDirectorState(script: WeatherScript = constantWeatherScript()): WeatherDirectorState {
  return {
    script,
    stepIndex: -1,
    from: { ...CLEAR_WEATHER },
    rampElapsed: 0,
    elapsed: 0,
    river: { ...CLEAR_WEATHER },
    overSegment: null,
    ambient: null,
  };
}

/**
 * Blend `from` toward `to` at ramp progress `p` (0..1). Fading out keeps the
 * old type until it is gone; fading in (or between intensities of one type)
 * takes the new type at once; a swap of two weathers crosses directly.
 */
export function blendWeather(from: RunWeather, to: RunWeather, p: number, out: RunWeather): RunWeather {
  const t = clamp01(p);
  const fromLive = from.type !== 'clear' && from.intensity > 0;
  const toLive = to.type !== 'clear' && to.intensity > 0;
  if (!toLive) {
    if (!fromLive || t >= 1) {
      out.type = 'clear';
      out.intensity = 0;
    } else {
      out.type = from.type;
      out.intensity = from.intensity * (1 - t);
    }
    return out;
  }
  out.type = to.type;
  out.intensity = lerp(fromLive ? from.intensity : 0, to.intensity, t);
  if (t >= 1) out.intensity = to.intensity;
  return out;
}

/**
 * Advance the director by `dtSec` sim seconds at map progress `reachFraction`.
 * Takes every step whose fraction has been reached (several at once after a
 * long jump); each new step ramps from whatever the river was doing.
 */
export function stepWeatherDirector(state: WeatherDirectorState, reachFraction: number, dtSec: number): void {
  const dt = dtSec > 0 && Number.isFinite(dtSec) ? dtSec : 0;
  const fraction = Number.isFinite(reachFraction) ? reachFraction : 0;
  const { script } = state;
  while (state.stepIndex + 1 < script.length && script[state.stepIndex + 1].atReachFraction <= fraction) {
    state.from.type = state.river.type;
    state.from.intensity = state.river.intensity;
    state.stepIndex += 1;
    state.rampElapsed = 0;
  }
  state.elapsed += dt;
  if (state.stepIndex < 0) return;
  const step = script[state.stepIndex];
  state.rampElapsed += dt;
  const p = step.rampSeconds > 0 ? smoothstep(state.rampElapsed / step.rampSeconds, 0, 1) : 1;
  blendWeather(state.from, { type: step.weather, intensity: step.intensity }, p, state.river);
  state.overSegment = step.overSegment ?? null;
}

/** The weather the scene shows: the river's when it is live, else the ambient one. */
export function visualWeather(state: WeatherDirectorState): RunWeather {
  if (state.river.type !== 'clear' && state.river.intensity > 0) return state.river;
  return state.ambient ?? CLEAR_WEATHER;
}

function rippleFor(type: WeatherType): number {
  if (type === 'storm') return WEATHER_CONFIG.water.stormRippleStrength;
  if (type === 'rain') return WEATHER_CONFIG.water.rainRippleStrength;
  return 0;
}

/**
 * The store broadcast for the visual weather. The ambient snow keeps the
 * shape the biome rule always wrote (transition 1); scripted weather reports
 * its ramped intensity as the transition and scales the ripple with it.
 */
export function weatherBroadcastOf(state: WeatherDirectorState, out: WeatherBroadcast): WeatherBroadcast {
  const visual = visualWeather(state);
  if (visual.type === 'clear' || visual.intensity <= 0) {
    out.type = 'clear';
    out.intensity = 0;
    out.transition = 1;
    out.rippleStrength = 0;
    return out;
  }
  if (visual === state.ambient) {
    out.type = visual.type;
    out.intensity = visual.intensity;
    out.transition = 1;
    out.rippleStrength = rippleFor(visual.type);
    return out;
  }
  // The ripple scales with how far the ramp has come: toward the step's
  // intensity while a weather fades in, from the ramp's start while it fades out.
  const step = state.stepIndex >= 0 ? state.script[state.stepIndex] : null;
  const fadingIn = step !== null && step.weather === visual.type && step.intensity > 0;
  const fadingOut = step !== null && step.weather !== visual.type && state.from.type === visual.type && state.from.intensity > 0;
  const target = fadingIn ? step.intensity : fadingOut ? state.from.intensity : visual.intensity;
  out.type = visual.type;
  out.intensity = visual.intensity;
  out.transition = visual.intensity;
  out.rippleStrength = rippleFor(visual.type) * clamp01(visual.intensity / target);
  return out;
}

// ---------------------------------------------------------------------------
// The run's director (one per run session)
// ---------------------------------------------------------------------------

let director: WeatherDirectorState = createWeatherDirectorState();

/**
 * Start the director on a new run's script. Step 0 is taken at once, so the
 * river reads the launch weather before the first frame (the router spins up
 * on it, and the hull and surface read it at mount).
 */
export function resetWeatherDirector(script: WeatherScript): WeatherDirectorState {
  const ambient = director.ambient;
  director = createWeatherDirectorState(script);
  director.ambient = ambient;
  stepWeatherDirector(director, 0, 0);
  return director;
}

/**
 * Hand the director the next map's script mid-journey: the river keeps the
 * weather it has, and the next map's first step ramps from it.
 */
export function continueWeatherDirector(script: WeatherScript): void {
  const carried = { ...director.river };
  const elapsed = director.elapsed;
  const ambient = director.ambient;
  director = createWeatherDirectorState(script);
  director.river = carried;
  director.from = { ...carried };
  director.elapsed = elapsed;
  director.ambient = ambient;
}

export function getWeatherDirector(): Readonly<WeatherDirectorState> {
  return director;
}

/** Advance the run's director (the SimCore `weather-director` system, once per sim step). */
export function tickWeatherDirector(reachFraction: number, dtSec: number): void {
  stepWeatherDirector(director, reachFraction, dtSec);
}

/** Ambient weather for the scene (reach manifest, glacial snow); null clears it. */
export function setWeatherDirectorAmbient(weather: RunWeather | null): void {
  if (!weather || weather.type === 'clear' || !(weather.intensity > 0)) {
    director.ambient = null;
    return;
  }
  director.ambient = { type: weather.type, intensity: clamp01(weather.intensity) };
}

/** The ambient weather a biome brings on its own (glacial snow), or null. */
export function biomeAmbientWeather(biomeId: string): RunWeather | null {
  return biomeId === 'glacialMelt' || biomeId === 'glacier' ? { type: 'snow', intensity: GLACIAL_AMBIENT_SNOW } : null;
}

/** The river's weather right now. */
export function getDirectorRiverWeather(): Readonly<RunWeather> {
  return director.river;
}

/** Map segment the river weather sits over (lateral inflow), or null for the head. */
export function getDirectorOverSegment(): number | null {
  return director.overSegment;
}

/** The scene's weather right now. */
export function getDirectorVisualWeather(): Readonly<RunWeather> {
  return visualWeather(director);
}

export function resetWeatherDirectorForTests(): void {
  director = createWeatherDirectorState();
}
