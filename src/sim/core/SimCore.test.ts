import { beforeEach, describe, expect, it } from 'vitest';
import { SIM_DT, SIM_MAX_SUBSTEPS, SIM_RNG_SEED, SimCore, type SimSystem } from './SimCore';
import { createRng } from '../../math/random';

function recorder(id: string, order: number, log: string[]): SimSystem {
  return { id, order, step: (_ctx, dt) => void log.push(`${id}:${dt === SIM_DT ? 'dt' : dt}`) };
}

describe('SimCore accumulator', () => {
  let core: SimCore;
  beforeEach(() => {
    core = new SimCore();
  });

  it('runs whole fixed steps across variable frame deltas and carries the remainder', () => {
    let steps = 0;
    core.register({ id: 'count', order: 1, step: () => void (steps += 1) });
    // 10 ms frames: 100 ms of wall time is 6 steps of 16.67 ms with 0 left over (0.1 − 6/60 = 0).
    for (let i = 0; i < 10; i += 1) core.advance(0.01);
    expect(steps).toBe(6);
    // A 40 ms frame is two steps, the 6.67 ms rest waits.
    steps = 0;
    expect(core.advance(0.04)).toBe(2);
    expect(steps).toBe(2);
  });

  it('hands every system the fixed dt, never the frame delta', () => {
    const seen: number[] = [];
    core.register({ id: 'dt', order: 1, step: (_c, dt) => void seen.push(dt) });
    core.advance(0.05);
    expect(seen).toEqual([SIM_DT, SIM_DT, SIM_DT]);
  });

  it('takes a delta a hair under one step as one step (float residue)', () => {
    expect(core.advance(SIM_DT - 1e-9)).toBe(1);
  });

  it('ignores zero, negative and non-finite deltas', () => {
    expect(core.advance(0)).toBe(0);
    expect(core.advance(-1)).toBe(0);
    expect(core.advance(Number.NaN)).toBe(0);
    expect(core.ctx.stepIndex).toBe(0);
  });

  it('clamps a stalled frame to SIM_MAX_SUBSTEPS and drops the backlog', () => {
    let steps = 0;
    core.register({ id: 'count', order: 1, step: () => void (steps += 1) });
    expect(core.advance(10)).toBe(SIM_MAX_SUBSTEPS);
    expect(steps).toBe(SIM_MAX_SUBSTEPS);
    // The 10 s were dropped, not owed: the next small frame owes nothing.
    expect(core.advance(0.001)).toBe(0);
    expect(core.ctx.time).toBeCloseTo(SIM_MAX_SUBSTEPS * SIM_DT, 12);
  });

  it('counts sim time and steps, and reset zeroes them', () => {
    core.advance(SIM_DT * 3);
    expect(core.ctx.stepIndex).toBe(3);
    expect(core.ctx.time).toBeCloseTo(3 * SIM_DT, 12);
    core.reset();
    expect(core.ctx.stepIndex).toBe(0);
    expect(core.ctx.time).toBe(0);
  });
});

describe('SimCore scripted mode (stepScripted shares the frame path\'s step)', () => {
  it('takes exactly one step per advance whatever the delta, so n frames are n steps', () => {
    const core = new SimCore();
    core.setScripted(true);
    // The scripted clock adds a 1e-6 bias to the first frame and float noise to the rest.
    const deltas = [SIM_DT + 1e-6, SIM_DT, SIM_DT - 1e-15, SIM_DT + 3e-16, 0, 5];
    for (const d of deltas) expect(core.advance(d)).toBe(1);
    expect(core.ctx.stepIndex).toBe(deltas.length);
  });

  it('runs the same system calls as the frame path fed exact 1/60 s frames', () => {
    const scriptedLog: string[] = [];
    const frameLog: string[] = [];
    const scripted = new SimCore();
    const live = new SimCore();
    scripted.setScripted(true);
    for (const [core, log] of [
      [scripted, scriptedLog],
      [live, frameLog],
    ] as const) {
      core.register({ id: 'a', order: 10, step: (c, dt) => void log.push(`a@${c.stepIndex}/${c.time.toFixed(6)}/${dt}`) });
      core.register({ id: 'b', order: 20, step: (c) => void log.push(`b@${c.stepIndex}:${c.rng().toFixed(8)}`) });
    }
    for (let i = 0; i < 90; i += 1) {
      scripted.advance(SIM_DT + (i === 0 ? 1e-6 : 0));
      live.advance(SIM_DT);
    }
    expect(scriptedLog).toEqual(frameLog);
    expect(scriptedLog).toHaveLength(180);
  });
});

describe('SimCore registry', () => {
  it('steps systems by order, ties in registration order', () => {
    const core = new SimCore();
    const log: string[] = [];
    core.register(recorder('late', 90, log));
    core.register(recorder('first', 10, log));
    core.register(recorder('mid-a', 40, log));
    core.register(recorder('mid-b', 40, log));
    expect(core.getSystemIds()).toEqual(['first', 'mid-a', 'mid-b', 'late']);
    core.step();
    expect(log).toEqual(['first:dt', 'mid-a:dt', 'mid-b:dt', 'late:dt']);
  });

  it('refuses a duplicate id and unregisters by the returned function', () => {
    const core = new SimCore();
    const off = core.register(recorder('x', 1, []));
    expect(() => core.register(recorder('x', 2, []))).toThrow(/already registered/);
    off();
    expect(core.getSystemIds()).toEqual([]);
    expect(() => core.register(recorder('x', 2, []))).not.toThrow();
  });

  it('attaches on register and tears down on unregister', () => {
    const core = new SimCore();
    const log: string[] = [];
    const off = core.register({
      id: 'listener',
      order: 1,
      step: () => {},
      attach: () => {
        log.push('attach');
        return () => log.push('detach');
      },
    });
    expect(log).toEqual(['attach']);
    off();
    off();
    expect(log).toEqual(['attach', 'detach']);
    core.register({ id: 'again', order: 1, step: () => {}, attach: () => void log.push('no-teardown') });
    core.unregister('again');
    expect(log).toEqual(['attach', 'detach', 'no-teardown']);
  });

  it('calls each system\'s reset on a run reset, in order', () => {
    const core = new SimCore();
    const log: string[] = [];
    core.register({ id: 'b', order: 2, step: () => {}, reset: () => void log.push('b') });
    core.register({ id: 'a', order: 1, step: () => {}, reset: () => void log.push('a') });
    core.register({ id: 'no-reset', order: 3, step: () => {} });
    core.reset();
    expect(log).toEqual(['a', 'b']);
  });
});

describe('SimContext rng', () => {
  it('starts as the stream the splash foam gate always drew from, and restarts from the top', () => {
    const core = new SimCore();
    const expected = createRng(SIM_RNG_SEED);
    const first = [core.ctx.rng(), core.ctx.rng(), core.ctx.rng()];
    expect(first).toEqual([expected(), expected(), expected()]);
    core.reset();
    expect([core.ctx.rng(), core.ctx.rng(), core.ctx.rng()]).toEqual(first);
  });

  it('keeps one identity across resets, and reseeds on request', () => {
    const core = new SimCore();
    const rng = core.ctx.rng;
    core.reset(42);
    expect(core.ctx.rng).toBe(rng);
    const a = createRng(42);
    expect(rng()).toBe(a());
    expect(core.getSeed()).toBe(42);
  });
});
