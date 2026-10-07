/**
 * simWorkerCore — particles and chores in the sim worker (one module per
 * session). The stub module emulates the kernels' shape; bit parity against
 * the real binary is simWorker.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { stubNativeModule as stubModule } from '../testing/stubNativeModule';
import { createSimWorkerCore } from './simWorkerCore';
import { SPLASH_WIRE_PLANES, type SimWorkerResponse } from './simWorkerProtocol';

function core() {
  const { mod, order } = stubModule();
  const out: { response: SimWorkerResponse; transfer?: Transferable[] }[] = [];
  const c = createSimWorkerCore(mod, (response, transfer) => out.push({ response, transfer }));
  return { mod, order, out, c };
}

function particlesResult(out: { response: SimWorkerResponse }[]) {
  const last = out[out.length - 1]?.response;
  if (last?.type !== 'PARTICLES') throw new Error(`expected PARTICLES, got ${last?.type}`);
  return last;
}

describe('simWorkerCore particles', () => {
  it('keeps the waterfall state in the worker and ships px | py | pz | scale back', () => {
    const { mod, out, c } = core();
    c.handle({ type: 'PARTICLES_ALLOC', poolId: 4, capacity: 8 });
    c.handle({
      type: 'PARTICLES_INIT_WATERFALL', poolId: 4, active: 8,
      width: 10, height: 20, depthZ: 5, fanSpreadRad: 0, seed: 7,
    });
    expect(mod.initWaterfallParticles).toHaveBeenCalledWith(expect.any(Number), 8, 8, 10, 20, 5, 0, 7);

    const outBuf = new ArrayBuffer(3 * 4 * 4);
    c.handle({
      type: 'PARTICLES_STEP_WATERFALL', poolId: 4, seq: 1, active: 3, dt: 0.5,
      width: 10, height: 20, depthZ: 5, out: outBuf,
    });
    // The seed the init returned is threaded into the step.
    expect(mod.stepWaterfallParticles).toHaveBeenLastCalledWith(expect.any(Number), 8, 3, 0.5, 10, 20, 5, 99);
    const result = particlesResult(out);
    expect(result).toMatchObject({ poolId: 4, seq: 1, count: 3 });
    expect(result.buffer).toBe(outBuf);
    expect(out[out.length - 1].transfer).toEqual([outBuf]);
    expect([...new Float32Array(result.buffer)]).toEqual([0, 1, 2, 19.5, 19.5, 19.5, -0, -1, -2, 0.5, 0.5, 0.5]);

    c.handle({
      type: 'PARTICLES_STEP_WATERFALL', poolId: 4, seq: 2, active: 3, dt: 0.5,
      width: 10, height: 20, depthZ: 5, out: new ArrayBuffer(48),
    });
    expect(mod.stepWaterfallParticles).toHaveBeenLastCalledWith(expect.any(Number), 8, 3, 0.5, 10, 20, 5, 100);
    expect(new Float32Array(particlesResult(out).buffer)[3]).toBe(19);
  });

  it('steps the main thread\'s splash state and returns it in the same buffer', () => {
    const { mod, out, c } = core();
    c.handle({ type: 'PARTICLES_ALLOC', poolId: 1, capacity: 4 });
    const n = 2;
    const wire = new Float32Array(n * SPLASH_WIRE_PLANES);
    // Plane by plane (two particles each): px | py | pz | vx | vy | vz | life | maxLife.
    // Particle 1 reaches its maxLife this step.
    wire.set([0, 1, 0, 0, 0, 0, 1, 2, 0, 0, 3, 0, 0.1, 0.45, 1, 0.5]);
    c.handle({
      type: 'PARTICLES_STEP_SPLASH', poolId: 1, seq: 9, count: n, dt: 0.1, gravityY: -10, damp: 0.5,
      planes: wire.buffer,
    });
    expect(mod.stepSplashParticles).toHaveBeenCalledWith(expect.any(Number), 4, 2, 0.1, -10, 0.5);
    const result = particlesResult(out);
    expect(result).toMatchObject({ poolId: 1, seq: 9, count: 2 });
    const back = new Float32Array(result.buffer);
    expect(back[0]).toBeCloseTo(0.1); // px0 += vx0 * dt
    expect(back[1]).toBeCloseTo(1.2); // px1 += vx1 * dt
    expect(back[2 * n]).toBeCloseTo(0.3); // pz0 += vz0 * dt
    expect(back[4 * n]).toBeCloseTo((0 - 10 * 0.1) * 0.5); // vy0: gravity, then damp
    expect(back[6 * n]).toBeCloseTo(0.2); // life0
    expect(back[6 * n + 1]).toBe(-1); // life1 >= maxLife → dead
    expect(back[7 * n + 1]).toBeCloseTo(0.5); // maxLife untouched
  });

  it('answers an unknown pool with an empty result and frees pools on FREE and dispose', () => {
    const { mod, out, c } = core();
    c.handle({
      type: 'PARTICLES_STEP_SPLASH', poolId: 3, seq: 1, count: 2, dt: 0.1, gravityY: 0, damp: 1,
      planes: new ArrayBuffer(64),
    });
    expect(particlesResult(out).count).toBe(0);
    expect(mod.stepSplashParticles).not.toHaveBeenCalled();

    c.handle({ type: 'PARTICLES_ALLOC', poolId: 1, capacity: 4 });
    c.handle({ type: 'PARTICLES_ALLOC', poolId: 2, capacity: 4 });
    c.handle({ type: 'PARTICLES_FREE', poolId: 1 });
    expect(mod.freeParticleSoA).toHaveBeenCalledTimes(1);
    c.dispose();
    expect(mod.freeParticleSoA).toHaveBeenCalledTimes(2);
  });
});

describe('simWorkerCore chores', () => {
  it('summarizes the live grid\'s h in place: reduce → histogram → downsample → blur', () => {
    const { order, out, c } = core();
    c.handle({ type: 'CONFIGURE', gridId: 1, width: 8, height: 4, dx: 0.5 });
    c.handle({ type: 'CHORES', seq: 5, gridId: 1, thumbWidth: 4, thumbHeight: 2 });
    const last = out[out.length - 1];
    expect(last.response.type).toBe('CHORES');
    if (last.response.type !== 'CHORES') return;
    expect(last.response.seq).toBe(5);
    const summary = last.response.summary!;
    expect(summary.histogram[3]).toBe(42);
    expect(summary.thumb).toMatchObject({ width: 4, height: 2 });
    expect([...summary.thumb.values]).toEqual(new Array(8).fill(3));
    expect(last.transfer).toEqual([summary.histogram.buffer, summary.thumb.values.buffer]);
    // The field is read on the heap where it lives: one pointer, no copy-in.
    const [reduce, histogram, downsample, blur] = order;
    expect(reduce).toMatch(/^reduce@\d+$/);
    expect(histogram).toBe(reduce.replace('reduce', 'histogram'));
    expect(downsample).toBe(reduce.replace('reduce', 'downsample'));
    expect(blur).toBe('blur');
  });

  it('answers null for a grid that is not live', () => {
    const { mod, out, c } = core();
    c.handle({ type: 'CONFIGURE', gridId: 2, width: 8, height: 4, dx: 0.5 });
    c.handle({ type: 'CHORES', seq: 1, gridId: 1, thumbWidth: 4, thumbHeight: 2 });
    expect(out[out.length - 1].response).toEqual({ type: 'CHORES', seq: 1, summary: null });
    expect(mod.reduceF32Grid).not.toHaveBeenCalled();
  });
});
