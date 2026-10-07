import { describe, expect, it } from 'vitest';
import {
  LIGHTNING_INTERVAL,
  THUNDER_DELAY,
  createLightningState,
  flashEnvelope,
  lightningSeed,
  stepLightning,
} from './lightning';

function strikeTimes(seed: number, seconds: number, active = true, intensity = 1): number[] {
  const state = createLightningState(seed);
  const out: number[] = [];
  for (let t = 0; t <= seconds; t += 1 / 60) {
    stepLightning(state, t, active, intensity);
    if (state.struck) out.push(t);
  }
  return out;
}

describe('lightning schedule', () => {
  it('strikes every 2–8 s in a full storm', () => {
    const times = strikeTimes(lightningSeed('glacial', 14), 120);
    expect(times.length).toBeGreaterThan(120 / LIGHTNING_INTERVAL.max - 1);
    for (let i = 1; i < times.length; i += 1) {
      const gap = times[i] - times[i - 1];
      expect(gap).toBeGreaterThanOrEqual(LIGHTNING_INTERVAL.min - 1 / 60);
      expect(gap).toBeLessThanOrEqual(LIGHTNING_INTERVAL.max + 1 / 60);
    }
  });

  it('is deterministic per run and differs between runs', () => {
    const a = strikeTimes(lightningSeed('glacial', 14), 60);
    expect(strikeTimes(lightningSeed('glacial', 14), 60)).toEqual(a);
    expect(strikeTimes(lightningSeed('glacial', 6), 60)).not.toEqual(a);
  });

  it('never strikes without a storm', () => {
    expect(strikeTimes(1234, 60, false)).toEqual([]);
  });

  it('flashes then decays to dark, with a thunder delay in range', () => {
    const state = createLightningState(lightningSeed('hydro', 15));
    let t = 0;
    while (!state.struck && t < 20) {
      stepLightning(state, t, true, 1);
      t += 1 / 60;
    }
    expect(state.struck).toBe(true);
    expect(state.flash).toBeGreaterThan(0.4);
    expect(state.thunderDelay).toBeGreaterThanOrEqual(THUNDER_DELAY.min);
    expect(state.thunderDelay).toBeLessThanOrEqual(THUNDER_DELAY.max);
    stepLightning(state, t + 1, false, 1);
    expect(state.flash).toBe(0);
  });

  it('has a re-strike flicker in the envelope', () => {
    expect(flashEnvelope(0)).toBe(1);
    expect(flashEnvelope(0.13)).toBeGreaterThan(flashEnvelope(0.11));
    expect(flashEnvelope(1)).toBe(0);
  });
});
