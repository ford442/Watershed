/**
 * nativeParticles — splash / waterfall integrate on the session's one module.
 * The worker lane runs the real simWorkerCore over a stub module, through a
 * real SimWorkerProxy; the main lane runs the stub module directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimWorkerProxy } from '../../sim/createSimWorkerProxy';
import { createSimWorkerCore } from '../../sim/simWorkerCore';
import type { SimWorkerCommand, SimWorkerLike, SimWorkerResponse } from '../../sim/simWorkerProtocol';
import { stubNativeModule } from '../../testing/stubNativeModule';
import type { WatershedNativeModule } from '../water/WatershedWasm';
import { createSplashIntegrator, createWaterfallIntegrator } from './nativeParticles';
import { ParticlePool, VFXParticle } from './ParticlePool';

/** Worker around the real core; messages cross only when the test pumps. */
function fakeWorker(wasm: WatershedNativeModule) {
  const toWorker: SimWorkerCommand[] = [];
  const toMain: SimWorkerResponse[] = [];
  const listeners = new Set<(event: MessageEvent<SimWorkerResponse>) => void>();
  const core = createSimWorkerCore(wasm, (response) => {
    toMain.push(response);
  });
  const worker = {
    postMessage: (message: SimWorkerCommand) => {
      toWorker.push(message);
    },
    terminate: vi.fn(),
    addEventListener: (type: string, l: (event: MessageEvent<SimWorkerResponse>) => void) => {
      if (type === 'message') listeners.add(l);
    },
    removeEventListener: (type: string, l: (event: MessageEvent<SimWorkerResponse>) => void) => {
      if (type === 'message') listeners.delete(l);
    },
  } as unknown as SimWorkerLike;
  const deliver = (response: SimWorkerResponse) => {
    for (const l of listeners) l({ data: response } as MessageEvent<SimWorkerResponse>);
  };
  const pump = () => {
    while (toWorker.length || toMain.length) {
      for (const c of toWorker.splice(0)) core.handle(c);
      for (const r of toMain.splice(0)) deliver(r);
    }
  };
  return { worker, pump, deliver };
}

function spawn(pool: ParticlePool<VFXParticle>, count: number, maxLife = 10) {
  return pool.acquireMultiple(count).map((p, i) => {
    p.position.set(i, 5, 0);
    p.velocity.set(1, 0, 0);
    p.life = 0;
    p.maxLife = maxLife;
    p.rotationSpeed = 1;
    return p;
  });
}

const jsUpdate = (p: VFXParticle) => p.update(0.1, -9.8);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('splash integrator', () => {
  it('returns null on a session without a module (native WebGPU): the JS integrate', () => {
    expect(createSplashIntegrator({ kind: 'none' }, 64)).toBeNull();
    expect(createWaterfallIntegrator({ kind: 'none' }, 64, { width: 1, height: 1, depthZ: 1, fanSpreadRad: 0, seed: 1 })).toBeNull();
  });

  it('main: steps in place on the module, overflow past its capacity in JS', () => {
    const { mod } = stubNativeModule();
    const integrator = createSplashIntegrator({ kind: 'main', wasm: mod }, 2)!;
    const pool = new ParticlePool(() => new VFXParticle(), 0, 10);
    const particles = spawn(pool, 3);
    const release = vi.fn((p: VFXParticle) => pool.release(p));
    integrator.integrate(particles, 0.1, -9.8, 0.98, jsUpdate, release);
    expect(mod.stepSplashParticles).toHaveBeenCalledWith(expect.any(Number), 2, 2, 0.1, -9.8, 0.98);
    // All three moved: two natively, the third (past the cap) in JS — none froze.
    for (let i = 0; i < 3; i += 1) expect(particles[i].position.x).toBeCloseTo(i + 0.1);
    expect(particles[0].rotation).toBeCloseTo(0.1);
    integrator.dispose();
    expect(mod.freeParticleSoA).toHaveBeenCalledTimes(1);
  });

  it('worker: applies a step one frame late, without stepping a waiting particle twice', () => {
    const { mod } = stubNativeModule();
    const { worker, pump } = fakeWorker(mod);
    const integrator = createSplashIntegrator({ kind: 'worker', proxy: new SimWorkerProxy(worker) }, 8)!;
    const pool = new ParticlePool(() => new VFXParticle(), 0, 10);
    const [a, b] = spawn(pool, 2);
    const release = (p: VFXParticle) => pool.release(p);

    integrator.integrate([...pool.getActive()], 0.1, -9.8, 0.98, jsUpdate, release);
    expect(a.position.x).toBe(0); // posted, not applied yet

    // The step has not landed: a and b wait; a fresh spawn takes the JS integrate.
    const [c] = spawn(pool, 1);
    integrator.integrate([...pool.getActive()], 0.1, -9.8, 0.98, jsUpdate, release);
    expect(a.position.x).toBe(0);
    expect(c.position.x).toBeCloseTo(0.1);

    pump();
    integrator.integrate([...pool.getActive()], 0.1, -9.8, 0.98, jsUpdate, release);
    expect(a.position.x).toBeCloseTo(0.1);
    expect(b.position.x).toBeCloseTo(1.1);
    expect(a.life).toBeCloseTo(0.1);
    expect(mod.stepSplashParticles).toHaveBeenCalledTimes(1);
  });

  it('worker: drops a result for a particle released and re-spawned while in flight', () => {
    const { mod } = stubNativeModule();
    const { worker, pump } = fakeWorker(mod);
    const integrator = createSplashIntegrator({ kind: 'worker', proxy: new SimWorkerProxy(worker) }, 8)!;
    const pool = new ParticlePool(() => new VFXParticle(), 0, 10);
    const [a] = spawn(pool, 1);
    const release = (p: VFXParticle) => pool.release(p);
    integrator.integrate([...pool.getActive()], 0.1, -9.8, 0.98, jsUpdate, release);

    pool.release(a);
    const [again] = spawn(pool, 1);
    expect(again).toBe(a); // same object, next life
    again.position.set(40, 0, 0);
    pump();
    integrator.integrate([], 0.1, -9.8, 0.98, jsUpdate, release);
    expect(again.position.x).toBe(40);
  });

  it('worker: releases particles whose native step ended their life', () => {
    const { mod } = stubNativeModule();
    const { worker, pump } = fakeWorker(mod);
    const integrator = createSplashIntegrator({ kind: 'worker', proxy: new SimWorkerProxy(worker) }, 8)!;
    const pool = new ParticlePool(() => new VFXParticle(), 0, 10);
    spawn(pool, 2, 0.05);
    const release = vi.fn((p: VFXParticle) => pool.release(p));
    integrator.integrate([...pool.getActive()], 0.1, -9.8, 0.98, jsUpdate, release);
    pump();
    integrator.integrate([...pool.getActive()], 0.1, -9.8, 0.98, jsUpdate, release);
    expect(release).toHaveBeenCalledTimes(2);
    expect(pool.getActive()).toHaveLength(0);
  });

  it('worker: falls back to JS once the worker dies, including particles that were in flight', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { mod } = stubNativeModule();
    const { worker, deliver } = fakeWorker(mod);
    const integrator = createSplashIntegrator({ kind: 'worker', proxy: new SimWorkerProxy(worker) }, 8)!;
    const pool = new ParticlePool(() => new VFXParticle(), 0, 10);
    const [a] = spawn(pool, 1);
    const release = (p: VFXParticle) => pool.release(p);
    integrator.integrate([...pool.getActive()], 0.1, -9.8, 0.98, jsUpdate, release);
    deliver({ type: 'ERROR', error: 'boom', fatal: true });
    integrator.integrate([...pool.getActive()], 0.1, -9.8, 0.98, jsUpdate, release);
    expect(a.position.x).toBeCloseTo(0.1);
  });
});

describe('waterfall integrator', () => {
  const chute = { width: 10, height: 20, depthZ: 5, fanSpreadRad: 0, seed: 3 };

  it('main: steps on the module and writes every active particle', () => {
    const { mod } = stubNativeModule();
    const integrator = createWaterfallIntegrator({ kind: 'main', wasm: mod }, 8, chute)!;
    const write = vi.fn();
    expect(integrator.step(4, 0.5, write)).toBe(4);
    expect(write).toHaveBeenCalledTimes(4);
    expect(write).toHaveBeenNthCalledWith(2, 1, 1, 19.5, -1, 0.5);
  });

  it('worker: inits in the worker, writes the landed step a frame later, carries a busy frame\'s dt', () => {
    const { mod } = stubNativeModule();
    const { worker, pump } = fakeWorker(mod);
    const integrator = createWaterfallIntegrator({ kind: 'worker', proxy: new SimWorkerProxy(worker) }, 8, chute)!;
    const write = vi.fn();
    expect(integrator.step(4, 0.25, write)).toBe(-1); // nothing landed: keep the matrices
    expect(integrator.step(4, 0.25, write)).toBe(-1); // still busy: dt rides on the next step
    pump();
    expect(mod.initWaterfallParticles).toHaveBeenCalledTimes(1);
    expect(integrator.step(4, 0.25, write)).toBe(4);
    expect(write).toHaveBeenNthCalledWith(1, 0, 0, 19.75, -0, 0.5);
    pump();
    write.mockClear();
    expect(integrator.step(4, 0.25, write)).toBe(4);
    // The second step carried both busy frames (0.25 + 0.25).
    expect(write).toHaveBeenNthCalledWith(1, 0, 0, 19.25, -0, 0.5);
    integrator.dispose();
    pump();
    expect(mod.freeParticleSoA).toHaveBeenCalledTimes(1);
  });
});
