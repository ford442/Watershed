/**
 * WeatherDirectorTick — steps the run's WeatherDirector from the R3F frame loop.
 *
 * Null component mounted once inside the Canvas. Each unpaused frame it hands
 * the director the frame's sim delta and the player's map progress, keeps the
 * director's ambient weather in step with the biome (glacial snow) or a reach
 * manifest, and writes the store's `weather` slice when the visual weather
 * changes. It runs just after the input hub (−100) and before every
 * default-priority subscriber, so the water, the hull and WeatherSystem all
 * read this frame's weather.
 */
import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore, type WeatherBroadcast } from '../GameState';
import { getRunMap } from '../journey/runSession';
import type { RunWeather } from '../map/weatherInflow';
import {
  biomeAmbientWeather,
  getWeatherDirector,
  setWeatherDirectorAmbient,
  tickWeatherDirector,
  weatherBroadcastOf,
} from './weatherDirector';
import { mapReachFraction } from './reachFraction';

export const WEATHER_DIRECTOR_PRIORITY = -90;

/** Store writes skip changes smaller than this (a ramp still lands every ~1%). */
const BROADCAST_EPSILON = 0.005;

let reachAmbient: RunWeather | null = null;
// Frame scratch: the broadcast is built here and copied into the store only when it changed.
const NEXT_BROADCAST: WeatherBroadcast = { type: 'clear', intensity: 0, transition: 1, rippleStrength: 0 };

/** A reach manifest's weather, shown when the run's own weather is clear (null clears it). */
export function setReachAmbientWeather(weather: RunWeather | null): void {
  reachAmbient = weather;
  setWeatherDirectorAmbient(reachAmbient ?? biomeAmbientWeather(useGameStore.getState().currentBiome));
}

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

export function WeatherDirectorTick(): null {
  useEffect(() => {
    const apply = (biome: string) => setWeatherDirectorAmbient(reachAmbient ?? biomeAmbientWeather(biome));
    apply(useGameStore.getState().currentBiome);
    return useGameStore.subscribe((state, prev) => {
      if (state.currentBiome !== prev.currentBiome) apply(state.currentBiome);
    });
  }, []);

  useFrame((_, delta) => {
    const store = useGameStore.getState();
    if (!store.isPaused) {
      tickWeatherDirector(mapReachFraction(getRunMap(), store.currentSegmentIndex), delta);
    }
    const next = weatherBroadcastOf(getWeatherDirector(), NEXT_BROADCAST);
    if (broadcastChanged(store.weather, next)) store.setWeather({ ...next });
  }, WEATHER_DIRECTOR_PRIORITY);

  return null;
}

export default WeatherDirectorTick;
