/**
 * weatherSurge — a squall's flood front, crossing the SWE window (#464 D).
 *
 * The router already carries a storm's runoff: weather the director sits over
 * reach k joins the chain there (lateral inflow) and raises the routed edge
 * stage at k and below. That is the slow half — the river is higher. This is
 * the felt half: when a storm strengthens past SQUALL_SURGE_INTENSITY while the
 * player is on or below the reach it sits over, one front (a `surge` event,
 * applySWEEvent kind 4) runs through the window at the bore speed of its stage.
 *
 * The front lives in world z, so it is the same wave whichever way the window
 * moves. It enters on the side it will cross the window from: a runner outruns
 * a ~3 m/s bore, so it meets the front ahead of it; a slow raft is overtaken
 * from behind. One front per squall: the storm has to ease below half the
 * trigger before the next one can fire.
 *
 * Pure: host state in, one event call out. Deterministic in the step clock.
 */
import { HYDRO_KIND_SURGE, SURGE_DEFAULT_HALF_WIDTH, surgeFrontSpeed } from './hydroEvents';
import type { RouterWeather } from './riverRouter';
import type { SweEventCall } from './sweSim';

/** Storm intensity that sends a front. */
export const SQUALL_SURGE_INTENSITY = 0.6;
/** Front stage (m) per unit storm intensity: a 0.9 squall stands ~0.23 m. */
export const SQUALL_SURGE_STAGE = 0.25;
/** A front that never leaves the window (the player matching its speed) ends after this (s). */
export const SQUALL_SURGE_MAX_AGE = 90;
/** Smoothing (s) of the window's own velocity, which picks the side a front enters from. */
const WINDOW_VELOCITY_TAU = 1;
/** A respawn jump is not a velocity: per-step window speeds clamp to this (m/s). */
const WINDOW_VELOCITY_MAX = 60;

export interface SurgeFront {
  /** World z of the front's centre line. */
  z: number;
  stage: number;
  halfWidth: number;
  /** Front velocity along z (m/s); downstream is −Z, so negative. */
  vz: number;
  age: number;
}

export interface WeatherSurgeState {
  front: SurgeFront | null;
  /** False after a front fires, until the storm eases below half the trigger. */
  armed: boolean;
  /** Smoothed window velocity along z (m/s). */
  windowVz: number;
  lastOriginZ: number | null;
}

export function createWeatherSurgeState(): WeatherSurgeState {
  return { front: null, armed: true, windowVz: 0, lastOriginZ: null };
}

export function resetWeatherSurge(state: WeatherSurgeState): void {
  state.front = null;
  state.armed = true;
  state.windowVz = 0;
  state.lastOriginZ = null;
}

export interface SurgeWindow {
  originX: number;
  originZ: number;
  width: number;
  height: number;
  dx: number;
  /** Still-water depth the bore runs into (m). */
  depth: number;
}

/** True when the storm over `overChainIndex` drains past the player's reach. */
function playerBelowStorm(weather: RouterWeather, playerChain: number | null): boolean {
  if (playerChain === null) return false;
  // Weather with no reach rains on the head: every reach is below it.
  return weather.overChainIndex === null || playerChain >= weather.overChainIndex;
}

/**
 * Advance the surge by one solver step of `dt`: fire, move or end the front.
 * Returns the step's kind-4 event call, or null when no front is in the window.
 */
export function stepWeatherSurge(
  state: WeatherSurgeState,
  weather: RouterWeather,
  playerChain: number | null,
  win: SurgeWindow,
  dt: number,
): SweEventCall | null {
  if (!(dt > 0)) return null;
  if (state.lastOriginZ !== null) {
    const vz = Math.max(-WINDOW_VELOCITY_MAX, Math.min(WINDOW_VELOCITY_MAX, (win.originZ - state.lastOriginZ) / dt));
    state.windowVz += (vz - state.windowVz) * Math.min(1, dt / WINDOW_VELOCITY_TAU);
  }
  state.lastOriginZ = win.originZ;

  const storm = weather.type === 'storm' ? weather.intensity : 0;
  if (storm < 0.5 * SQUALL_SURGE_INTENSITY) state.armed = true;

  const top = win.originZ + (win.height - 1) * win.dx;
  if (!state.front && state.armed && storm >= SQUALL_SURGE_INTENSITY && playerBelowStorm(weather, playerChain)) {
    const stage = SQUALL_SURGE_STAGE * storm;
    const vz = -surgeFrontSpeed(stage, win.depth);
    // Relative to the window the front moves at vz − windowVz: toward −Z it
    // enters from the upstream (top) edge, toward +Z from the downstream one.
    const enterTop = vz - state.windowVz < 0;
    state.front = { z: enterTop ? top : win.originZ, stage, halfWidth: SURGE_DEFAULT_HALF_WIDTH, vz, age: 0 };
    state.armed = false;
  }

  const front = state.front;
  if (!front) return null;
  front.z += front.vz * dt;
  front.age += dt;
  const outside = front.z < win.originZ - front.halfWidth || front.z > top + front.halfWidth;
  if (outside || front.age > SQUALL_SURGE_MAX_AGE) {
    state.front = null;
    return null;
  }
  return {
    kind: HYDRO_KIND_SURGE,
    cx: win.originX + 0.5 * (win.width - 1) * win.dx,
    cz: front.z,
    radius: front.halfWidth,
    strength: front.stage,
    dt,
  };
}
