import { describe, expect, it } from 'vitest';
import { HYDRO_KIND_SURGE, surgeFrontSpeed } from './hydroEvents';
import type { RouterWeather } from './riverRouter';
import {
  SQUALL_SURGE_INTENSITY,
  SQUALL_SURGE_STAGE,
  createWeatherSurgeState,
  stepWeatherSurge,
  type SurgeWindow,
} from './weatherSurge';

const DT = 1 / 60;
const CLEAR: RouterWeather = { type: 'clear', intensity: 0, overChainIndex: null };
const squallOver = (k: number | null, intensity = 0.9): RouterWeather => ({ type: 'storm', intensity, overChainIndex: k });

function windowAt(originZ: number): SurgeWindow {
  return { originX: -16, originZ, width: 64, height: 64, dx: 0.5, depth: 1 };
}

describe('stepWeatherSurge', () => {
  it('fires one front when a squall strengthens over the player’s reach, and it runs at the bore speed', () => {
    const state = createWeatherSurgeState();
    const win = windowAt(-100);
    expect(stepWeatherSurge(state, squallOver(2, 0.5), 2, win, DT)).toBeNull();
    const first = stepWeatherSurge(state, squallOver(2), 2, win, DT)!;
    expect(first.kind).toBe(HYDRO_KIND_SURGE);
    expect(first.strength).toBeCloseTo(SQUALL_SURGE_STAGE * 0.9, 6);
    const speed = surgeFrontSpeed(first.strength, win.depth);
    // A still window: the front enters at the upstream (+Z) edge and runs −Z.
    const top = win.originZ + (win.height - 1) * win.dx;
    expect(first.cz).toBeCloseTo(top - speed * DT, 6);
    const second = stepWeatherSurge(state, squallOver(2), 2, win, DT)!;
    expect(first.cz - second.cz).toBeCloseTo(speed * DT, 6);
  });

  it('does not fire for a player above the reach the storm sits over, or for rain', () => {
    const state = createWeatherSurgeState();
    expect(stepWeatherSurge(state, squallOver(5), 2, windowAt(0), DT)).toBeNull();
    expect(stepWeatherSurge(state, { type: 'rain', intensity: 1, overChainIndex: 2 }, 2, windowAt(0), DT)).toBeNull();
    expect(stepWeatherSurge(state, squallOver(2), null, windowAt(0), DT)).toBeNull();
    // Reaching the storm's reach while it still blows fires it.
    expect(stepWeatherSurge(state, squallOver(5), 5, windowAt(0), DT)).not.toBeNull();
  });

  it('sends one front per squall: re-arms only once the storm eases', () => {
    const state = createWeatherSurgeState();
    const win = windowAt(0);
    let fronts = 0;
    let prev = false;
    const run = (weather: RouterWeather, steps: number) => {
      for (let i = 0; i < steps; i += 1) {
        const live = stepWeatherSurge(state, weather, 3, win, DT) !== null;
        if (live && !prev) fronts += 1;
        prev = live;
      }
    };
    run(squallOver(1), 60 * 60);
    expect(fronts).toBe(1);
    run(squallOver(1, SQUALL_SURGE_INTENSITY), 60 * 10);
    expect(fronts).toBe(1);
    run(CLEAR, 60);
    run(squallOver(1), 60);
    expect(fronts).toBe(2);
  });

  it('a runner outrunning the front meets it ahead; it leaves through the upstream edge', () => {
    const state = createWeatherSurgeState();
    let originZ = 0;
    const runnerSpeed = 12;
    // Settle the window's velocity first.
    for (let i = 0; i < 180; i += 1) {
      originZ -= runnerSpeed * DT;
      stepWeatherSurge(state, CLEAR, 3, windowAt(originZ), DT);
    }
    originZ -= runnerSpeed * DT;
    const call = stepWeatherSurge(state, squallOver(1), 3, windowAt(originZ), DT)!;
    expect(call.cz).toBeLessThan(originZ + 1);
    let steps = 0;
    let lastCz = call.cz;
    while (state.front && steps < 60 * 60) {
      originZ -= runnerSpeed * DT;
      const c = stepWeatherSurge(state, squallOver(1), 3, windowAt(originZ), DT);
      if (c) lastCz = c.cz;
      steps += 1;
    }
    expect(state.front).toBeNull();
    const top = originZ + 63 * 0.5;
    expect(lastCz).toBeGreaterThan(top - 1);
  });

  it('is deterministic in the step clock', () => {
    const trace = () => {
      const state = createWeatherSurgeState();
      const out: number[] = [];
      for (let i = 0; i < 600; i += 1) {
        const weather = i < 100 ? CLEAR : squallOver(0, Math.min(1, (i - 100) / 200));
        const c = stepWeatherSurge(state, weather, 0, windowAt(-i * 0.1), DT);
        out.push(c ? c.cz : Number.NaN);
      }
      return out;
    };
    expect(trace()).toEqual(trace());
  });
});
