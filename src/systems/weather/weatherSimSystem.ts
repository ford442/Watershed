/**
 * weatherSimSystem — the weather director as a SimCore system (#521 A).
 *
 * Moved, not rewritten, from WeatherDirectorTick's useFrame: each unpaused sim
 * step it hands the director the step's dt and the player's map progress, then
 * writes the store's `weather` slice when the visual weather changed. SimCore
 * runs it first (order 10), ahead of every default-priority subscriber, so the
 * water, the hull and WeatherSystem all read this frame's weather.
 */
import type { WeatherBroadcast } from './weatherBroadcast';
import { getRunMap } from '../journey/runSession';
import type { SimSystem } from '../../sim/core/SimCore';
import {
  getWeatherDirector,
  tickWeatherDirector,
  weatherBroadcastOf,
} from './weatherDirector';
import { mapReachFraction } from './reachFraction';

export const WEATHER_SIM_ORDER = 10;

/** Store writes skip changes smaller than this (a ramp still lands every ~1%). */
const BROADCAST_EPSILON = 0.005;

// Step scratch: the broadcast is built here and copied into the store only when it changed.
const NEXT_BROADCAST: WeatherBroadcast = { type: 'clear', intensity: 0, transition: 1, rippleStrength: 0 };

function broadcastChanged(prev: WeatherBroadcast, next: WeatherBroadcast): boolean {
  return (
    prev.type !== next.type ||
    Math.abs(prev.intensity - next.intensity) > BROADCAST_EPSILON ||
    Math.abs(prev.transition - next.transition) > BROADCAST_EPSILON ||
    Math.abs(prev.rippleStrength - next.rippleStrength) > BROADCAST_EPSILON ||
    // Always land the end of a ramp exactly.
    (prev.intensity !== next.intensity && (next.intensity === 0 || next.transition === 1))
  );
}

export function createWeatherSimSystem(): SimSystem {
  return {
    id: 'weather-director',
    order: WEATHER_SIM_ORDER,
    step(ctx, dt) {
      const game = ctx.game.state();
      if (!game.isPaused) {
        tickWeatherDirector(mapReachFraction(getRunMap(), game.currentSegmentIndex), dt);
      }
      const next = weatherBroadcastOf(getWeatherDirector(), NEXT_BROADCAST);
      if (broadcastChanged(game.weather, next)) game.setWeather({ ...next });
    },
  };
}
