/**
 * WeatherDirectorTick — keeps the director's ambient weather in step with the biome.
 *
 * Null component mounted once inside the Canvas. The director itself is stepped
 * by SimCore (`weatherSimSystem.ts`, order 10); this only follows the store's
 * biome so glacial snow (or a reach manifest's weather) is the ambient the
 * director shows when the run's own weather is clear.
 */
import { useEffect } from 'react';
import { useGameStore } from '../GameState';
import type { RunWeather } from '../map/weatherInflow';
import { biomeAmbientWeather, setWeatherDirectorAmbient } from './weatherDirector';

let reachAmbient: RunWeather | null = null;

/** A reach manifest's weather, shown when the run's own weather is clear (null clears it). */
export function setReachAmbientWeather(weather: RunWeather | null): void {
  reachAmbient = weather;
  setWeatherDirectorAmbient(reachAmbient ?? biomeAmbientWeather(useGameStore.getState().currentBiome));
}

/** The ambient weather for a biome, unless a reach manifest has set its own. */
function applyAmbientWeatherForBiome(biome: string): void {
  setWeatherDirectorAmbient(reachAmbient ?? biomeAmbientWeather(biome));
}

export function WeatherDirectorTick(): null {
  useEffect(() => {
    applyAmbientWeatherForBiome(useGameStore.getState().currentBiome);
    return useGameStore.subscribe((state, prev) => {
      if (state.currentBiome !== prev.currentBiome) applyAmbientWeatherForBiome(state.currentBiome);
    });
  }, []);

  return null;
}
