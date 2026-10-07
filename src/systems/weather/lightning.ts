/**
 * lightning.ts — storm strike schedule and flash envelope (#464).
 *
 * No strike solver: a strike is a moment in time. It drives a strobe on the
 * key light, a short tone-mapping exposure kick and a delayed thunder one-shot
 * (WeatherSystem). The schedule is seeded from the run (map + launch hour) so
 * the same run strikes at the same moments — replays stay deterministic.
 *
 * Mutates one state object in place; nothing here allocates per frame.
 */

/** Seconds between strikes at full storm intensity (lighter storms stretch it). */
export const LIGHTNING_INTERVAL = { min: 2, max: 8 } as const;
/** Length of one flash envelope (s). */
export const LIGHTNING_FLASH_SECONDS = 0.45;
/** Thunder delay range (s) — the strike's distance, as sound travel. */
export const THUNDER_DELAY = { min: 0.25, max: 2.6 } as const;

export interface LightningState {
  /** RNG state (mulberry32). */
  rng: number;
  /** Run time of the next strike, or -1 before the first scheduled one. */
  nextStrikeAt: number;
  /** Run time of the latest strike, or -Infinity. */
  lastStrikeAt: number;
  /** 0..1 — the latest strike's nearness (1 = overhead). */
  nearness: number;
  /** Flash envelope this step, 0..1 (× nearness). */
  flash: number;
  /** True only on the step a strike begins. */
  struck: boolean;
  /** Thunder delay (s) for the strike that just began. */
  thunderDelay: number;
}

/** FNV-1a of the run identity → seed. */
export function lightningSeed(mapId: string, launchHour: number): number {
  const key = `${mapId}@${launchHour}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createLightningState(seed: number): LightningState {
  return {
    rng: seed >>> 0 || 1,
    nextStrikeAt: -1,
    lastStrikeAt: Number.NEGATIVE_INFINITY,
    nearness: 0,
    flash: 0,
    struck: false,
    thunderDelay: 0,
  };
}

function nextRandom(state: LightningState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function scheduleNext(state: LightningState, from: number, intensity: number): void {
  const span = LIGHTNING_INTERVAL.min + (LIGHTNING_INTERVAL.max - LIGHTNING_INTERVAL.min) * nextRandom(state);
  // A weak storm strikes less often (up to 2× the interval at intensity 0).
  state.nextStrikeAt = from + span * (2 - Math.min(1, Math.max(0, intensity)));
}

/**
 * Flash shape: a hard primary pulse and a weaker re-strike ~120 ms later,
 * the double flicker of a real return stroke.
 */
export function flashEnvelope(age: number): number {
  if (age < 0 || age > LIGHTNING_FLASH_SECONDS) return 0;
  const primary = Math.exp(-age / 0.05);
  const restrike = age > 0.12 ? 0.6 * Math.exp(-(age - 0.12) / 0.07) : 0;
  return Math.min(1, primary + restrike);
}

/**
 * Advance to run time `time`. `active` is whether a storm is currently
 * established (WeatherSystem's transition), `intensity` its strength.
 */
export function stepLightning(state: LightningState, time: number, active: boolean, intensity: number): void {
  state.struck = false;
  if (!active) {
    // No storm: no queued strike, and any flash still decays out.
    state.nextStrikeAt = -1;
  } else if (state.nextStrikeAt < 0) {
    scheduleNext(state, time, intensity);
  } else if (time >= state.nextStrikeAt) {
    state.lastStrikeAt = time;
    state.nearness = 0.45 + 0.55 * nextRandom(state);
    // Near strikes thunder sooner.
    state.thunderDelay =
      THUNDER_DELAY.min + (THUNDER_DELAY.max - THUNDER_DELAY.min) * (1 - state.nearness) * (0.7 + 0.3 * nextRandom(state));
    state.struck = true;
    scheduleNext(state, time, intensity);
  }
  state.flash = flashEnvelope(time - state.lastStrikeAt) * state.nearness;
}
