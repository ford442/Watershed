/**
 * skyClock.ts — the run's time of day: the launch hour plus sim time, sped up.
 *
 *   hour = launchHour + elapsedSimSeconds × timeSpeedup / 3600
 *
 * One clock per run (reset by runSession.initRunSession), advanced by
 * the SimCore `sky-clock` system (skySimSystem.ts) on the fixed sim step while
 * the game is unpaused (SkyClockTick only places the sun), so a
 * scripted replay sees the same sun on the same frame. The sun itself comes
 * from sunPosition() for the map's latitude and day (maps/atmosphere.ts).
 *
 * Readers:
 *   per frame   getSkyClock() — the sun vector and the derived factors
 *               (lighting, sky, water, post).
 *   coarse      subscribeSkyPhase() — fires when the quantized daylight
 *               fraction or the night flag changes (~every 5 game minutes),
 *               for React state such as BiomeProvider's `timeOfDay`.
 *
 * Module state mutated in place; a tick allocates nothing.
 */
import { DEFAULT_ATMOSPHERE, type MapAtmosphere } from '../../maps/atmosphere';
import { smoothstep } from '../../math/scalar';
import { createSunSample, daylightFraction, daylightSpan, sunPosition, type DaylightSpan, type SunSample } from './sunPosition';

/** The hour a page shows before any run starts (the old fixed "10am"). */
export const IDLE_SKY_HOUR = 10;
/** Coarse readers hear about the daylight fraction in steps of this much (~5 game min on a 13 h day). */
export const SKY_PHASE_STEP = 1 / 160;

const DEG = Math.PI / 180;
/** Elevation at which the sun counts as fully up for lighting (`elevation01` = 1). */
const FULL_SUN_ELEVATION = 30 * DEG;

export interface SkyFactors {
  /** Daylight fraction: 0 sunrise, 0.5 noon, 1 sunset, outside [0, 1] at night (BiomeProvider's timeOfDay). */
  daylight: number;
  /** 0 by day, 1 once the sun is 8° below the horizon (stars, moon, night dimming). */
  night: number;
  /** Afternoon golden hour, 0..1 (zero at night). */
  golden: number;
  /** Sun height for lighting: sin(elevation) / sin(30°), clamped 0..1. */
  elevation01: number;
}

export interface SkyClockState {
  launchHour: number;
  elapsedSimSec: number;
  atmosphere: MapAtmosphere;
  span: DaylightSpan;
  /** The game hour now (may run past 24). */
  hour: number;
  sun: SunSample;
  factors: SkyFactors;
}

/** Game hour `elapsedSimSec` after `launchHour` at `speedup` game seconds per sim second. */
export function gameHourAt(launchHour: number, elapsedSimSec: number, speedup: number): number {
  return launchHour + (elapsedSimSec * speedup) / 3600;
}

/** The scene factors for a sun sample at `hour`. */
export function skyFactorsFor(sun: SunSample, hour: number, span: DaylightSpan, out: SkyFactors): SkyFactors {
  const elevationDeg = sun.elevation / DEG;
  out.daylight = daylightFraction(hour, span);
  out.night = 1 - smoothstep(elevationDeg, -8, 1);
  out.golden = smoothstep(out.daylight, 0.65, 0.9) * (1 - out.night);
  out.elevation01 = Math.max(0, Math.min(1, Math.sin(sun.elevation) / Math.sin(FULL_SUN_ELEVATION)));
  return out;
}

function createState(launchHour: number, atmosphere: MapAtmosphere): SkyClockState {
  const state: SkyClockState = {
    launchHour,
    elapsedSimSec: 0,
    atmosphere,
    span: daylightSpan(atmosphere.latitudeDeg, atmosphere.dayOfYear),
    hour: launchHour,
    sun: createSunSample(),
    factors: { daylight: 0.5, night: 0, golden: 0, elevation01: 1 },
  };
  refresh(state);
  return state;
}

function refresh(state: SkyClockState): void {
  state.hour = gameHourAt(state.launchHour, state.elapsedSimSec, state.atmosphere.timeSpeedup);
  sunPosition(state.hour, state.atmosphere.latitudeDeg, state.atmosphere.dayOfYear, state.sun);
  skyFactorsFor(state.sun, state.hour, state.span, state.factors);
}

let clock: SkyClockState = createState(IDLE_SKY_HOUR, DEFAULT_ATMOSPHERE);

// ---------------------------------------------------------------------------
// Coarse phase listeners
// ---------------------------------------------------------------------------

export interface SkyPhase {
  /** Daylight fraction quantized to SKY_PHASE_STEP. */
  timeOfDay: number;
  isNight: boolean;
}

type PhaseListener = (phase: SkyPhase) => void;
const listeners = new Set<PhaseListener>();
let phase: SkyPhase = phaseOf(clock);

function phaseOf(state: SkyClockState): SkyPhase {
  return {
    timeOfDay: Math.round(state.factors.daylight / SKY_PHASE_STEP) * SKY_PHASE_STEP,
    isNight: state.factors.night >= 0.5,
  };
}

function publishPhase(): void {
  const next = phaseOf(clock);
  if (next.timeOfDay === phase.timeOfDay && next.isNight === phase.isNight) return;
  phase = next;
  for (const listener of listeners) listener(phase);
}

/** The current coarse phase (what subscribers last heard). */
export function getSkyPhase(): SkyPhase {
  return phase;
}

/** Hear about coarse phase changes; returns the unsubscribe. */
export function subscribeSkyPhase(listener: PhaseListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// The run's clock
// ---------------------------------------------------------------------------

/** Start the clock for a run: `launchHour` on the start map's sky. */
export function resetSkyClock(launchHour: number, atmosphere: MapAtmosphere = DEFAULT_ATMOSPHERE): void {
  clock = createState(launchHour, atmosphere);
  publishPhase();
}

/** A journey's next map: same time of day, the new map's sky (latitude, day, speed). */
export function setSkyAtmosphere(atmosphere: MapAtmosphere): void {
  const hour = clock.hour;
  clock.atmosphere = atmosphere;
  clock.span = daylightSpan(atmosphere.latitudeDeg, atmosphere.dayOfYear);
  // Keep the hour continuous under the new speed-up.
  clock.launchHour = hour;
  clock.elapsedSimSec = 0;
  refresh(clock);
  publishPhase();
}

/** Advance by `dtSec` sim seconds (the SimCore `sky-clock` system, once per unpaused step). */
export function tickSkyClock(dtSec: number): void {
  if (!(dtSec > 0) || !Number.isFinite(dtSec)) return;
  clock.elapsedSimSec += dtSec;
  refresh(clock);
  publishPhase();
}

export function getSkyClock(): Readonly<SkyClockState> {
  return clock;
}

export function resetSkyClockForTests(): void {
  clock = createState(IDLE_SKY_HOUR, DEFAULT_ATMOSPHERE);
  phase = phaseOf(clock);
  listeners.clear();
}
