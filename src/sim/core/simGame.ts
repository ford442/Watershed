/**
 * simGame.ts — the run state the sim reads and writes, as a port (#556 A).
 *
 * The gameplay step (SimCore systems, the vehicle step) used to call
 * `useGameStore.getState()` wherever it needed the stamina, the segment or the
 * wipeout latch — so it could only run with the React app's Zustand store
 * loaded. It reads `ctx.game.state()` instead: the browser binds the store
 * (`experience/simGameBinding.ts`), a headless run binds a plain object
 * (`createPlainSimGame`). The view is the subset of `GameState` the sim
 * touches; the store satisfies it structurally, so nothing here imports it.
 *
 * `state()` is read again after a write that the same step reads back (a
 * store write replaces the store's state object; a plain view mutates).
 */
import type { WeatherBroadcast } from '../../systems/weather/weatherBroadcast';

export interface SimVec3 {
  x: number;
  y: number;
  z: number;
}

/** The run state the sim reads (fields) and writes (setters). */
export interface SimGameView {
  readonly isPaused: boolean;
  readonly isWipeout: boolean;
  /** The segment the player is in (the treadmill writes it). */
  readonly currentSegmentIndex: number;
  readonly currentBiome: string;
  /** Sprint stamina 0–1 (the runner's step integrates it). */
  readonly sprintStamina: number;
  /** World gravity scale (waterfall / steep rapids). */
  readonly waterfallGravityMultiplier: number;
  /** Where a wipeout respawns (a segment index into `spawnPoints`). */
  readonly respawnSegmentIndex: number;
  readonly spawnPoints: Readonly<Record<number, SimVec3>>;
  readonly weather: Readonly<WeatherBroadcast>;
  setSprintStamina(v: number): void;
  setIsWipeout(wipeout: boolean): void;
  setIsDodging(dodging: boolean): void;
  setRespawnSegmentIndex(index: number): void;
  setWeather(weather: WeatherBroadcast): void;
}

export interface SimGamePort {
  /** The current view. Cheap (no allocation); read it per step, never keep it across a write. */
  state(): SimGameView;
}

/** Mutable fields of a plain view (a headless run, tests). */
export interface PlainSimGameFields {
  isPaused: boolean;
  isWipeout: boolean;
  isDodging: boolean;
  currentSegmentIndex: number;
  currentBiome: string;
  sprintStamina: number;
  waterfallGravityMultiplier: number;
  respawnSegmentIndex: number;
  spawnPoints: Record<number, SimVec3>;
  weather: WeatherBroadcast;
}

export type PlainSimGame = SimGamePort & { readonly view: SimGameView & PlainSimGameFields };

/** A view held in a plain object: what a run with no React app reads and writes. */
export function createPlainSimGame(init: Partial<PlainSimGameFields> = {}): PlainSimGame {
  const view: SimGameView & PlainSimGameFields = {
    isPaused: false,
    isWipeout: false,
    isDodging: false,
    currentSegmentIndex: 0,
    currentBiome: 'canyonSummer',
    sprintStamina: 1,
    waterfallGravityMultiplier: 1,
    respawnSegmentIndex: 0,
    spawnPoints: {},
    weather: { type: 'clear', intensity: 0, transition: 1, rippleStrength: 0 },
    ...init,
    // The store's setter clamps; so does this one.
    setSprintStamina(v) {
      view.sprintStamina = Math.min(1, Math.max(0, v));
    },
    setIsWipeout(wipeout) {
      view.isWipeout = wipeout;
    },
    setIsDodging(dodging) {
      view.isDodging = dodging;
    },
    setRespawnSegmentIndex(index) {
      view.respawnSegmentIndex = index;
    },
    setWeather(weather) {
      view.weather = weather;
    },
  };
  return { view, state: () => view };
}
