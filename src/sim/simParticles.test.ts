/**
 * simParticles / proxy routing — PARTICLES by pool, CHORES by seq, buffers on
 * the transfer list, one step in flight, nothing posted once the worker dies.
 * No binary: the worker is a stub that answers what it is told to.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimWorkerProxy } from './createSimWorkerProxy';
import { createSimParticleChannel } from './simParticles';
import type { SimWorkerCommand, SimWorkerLike, SimWorkerResponse } from './simWorkerProtocol';

type Listener = (event: { data?: SimWorkerResponse }) => void;

function stubWorker() {
  const listeners = new Set<Listener>();
  const posted: { command: SimWorkerCommand; transfer: Transferable[] }[] = [];
  const worker = {
    postMessage: vi.fn((command: SimWorkerCommand, transfer: Transferable[] = []) => {
      posted.push({ command, transfer });
    }),
    terminate: vi.fn(),
    addEventListener: (type: string, l: Listener) => {
      if (type === 'message') listeners.add(l);
    },
    removeEventListener: (type: string, l: Listener) => {
      if (type === 'message') listeners.delete(l);
    },
  };
  const deliver = (data: SimWorkerResponse) => listeners.forEach((l) => l({ data }));
  const last = <T extends SimWorkerCommand['type']>(type: T) =>
    [...posted].reverse().find((p) => p.command.type === type) as
      | { command: Extract<SimWorkerCommand, { type: T }>; transfer: Transferable[] }
      | undefined;
  return { worker: worker as unknown as SimWorkerLike, posted, deliver, last };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SimParticleChannel', () => {
  it('allocates its pool, posts one splash step at a time, and drains the landed result once', () => {
    const { worker, deliver, last } = stubWorker();
    const proxy = new SimWorkerProxy(worker);
    const channel = createSimParticleChannel(proxy, 16);
    expect(last('PARTICLES_ALLOC')?.command).toEqual({ type: 'PARTICLES_ALLOC', poolId: channel.poolId, capacity: 16 });

    const wire = channel.splashBuffer(3);
    expect(wire.length).toBe(3 * 8);
    expect(channel.stepSplash(wire, 3, 0.016, -9.8, 0.98)).toBe(true);
    const step = last('PARTICLES_STEP_SPLASH')!;
    expect(step.command).toMatchObject({ poolId: channel.poolId, count: 3, dt: 0.016, gravityY: -9.8, damp: 0.98 });
    expect(step.transfer).toEqual([wire.buffer]);
    expect(channel.busy).toBe(true);

    // Busy: a second step is refused, not queued.
    expect(channel.stepSplash(channel.splashBuffer(1), 1, 0.016, -9.8, 0.98)).toBe(false);

    const back = new ArrayBuffer(96);
    deliver({ type: 'PARTICLES', poolId: channel.poolId, seq: step.command.seq, count: 3, buffer: back });
    expect(channel.busy).toBe(false);
    expect(channel.drain()).toMatchObject({ seq: step.command.seq, count: 3, buffer: back });
    expect(channel.drain()).toBeNull();

    // A recycled buffer is reused for the next step instead of allocating.
    channel.recycle(back);
    expect(channel.splashBuffer(3).buffer).toBe(back);
  });

  it('ignores another pool\'s result and a stale seq', () => {
    const { worker, deliver, last } = stubWorker();
    const proxy = new SimWorkerProxy(worker);
    const a = createSimParticleChannel(proxy, 8);
    const b = createSimParticleChannel(proxy, 8);
    expect(a.poolId).not.toBe(b.poolId);
    a.stepWaterfall(4, 0.016, 10, 20, 5);
    const seq = last('PARTICLES_STEP_WATERFALL')!.command.seq;
    deliver({ type: 'PARTICLES', poolId: b.poolId, seq, count: 4, buffer: new ArrayBuffer(64) });
    expect(a.drain()).toBeNull();
    deliver({ type: 'PARTICLES', poolId: a.poolId, seq: seq + 7, count: 4, buffer: new ArrayBuffer(64) });
    expect(a.drain()).toBeNull();
    deliver({ type: 'PARTICLES', poolId: a.poolId, seq, count: 4, buffer: new ArrayBuffer(64) });
    expect(a.drain()?.count).toBe(4);
  });

  it('sizes the waterfall out buffer to the clamped count and sends the chute', () => {
    const { worker, last } = stubWorker();
    const channel = createSimParticleChannel(new SimWorkerProxy(worker), 8);
    channel.initWaterfall(8, 10, 20, 5, 0.3, 77);
    expect(last('PARTICLES_INIT_WATERFALL')?.command).toMatchObject({ active: 8, width: 10, height: 20, depthZ: 5, fanSpreadRad: 0.3, seed: 77 });
    channel.stepWaterfall(50, 0.02, 10, 20, 5);
    const step = last('PARTICLES_STEP_WATERFALL')!;
    expect(step.command.active).toBe(8);
    expect(step.command.out.byteLength).toBe(8 * 4 * 4);
    expect(step.transfer).toEqual([step.command.out]);
  });

  it('posts nothing once the worker is dead, and frees its pool on dispose', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { worker, deliver, posted } = stubWorker();
    const proxy = new SimWorkerProxy(worker);
    const channel = createSimParticleChannel(proxy, 8);
    channel.dispose();
    expect(posted[posted.length - 1].command).toEqual({ type: 'PARTICLES_FREE', poolId: channel.poolId });

    const live = createSimParticleChannel(proxy, 8);
    deliver({ type: 'ERROR', error: 'boom', fatal: true });
    expect(live.alive).toBe(false);
    const before = posted.length;
    expect(live.stepWaterfall(4, 0.016, 10, 20, 5)).toBe(false);
    expect(posted.length).toBe(before);
  });
});

describe('SimWorkerProxy chores', () => {
  it('resolves a CHORES request by seq with the worker\'s summary', async () => {
    const { worker, deliver, last } = stubWorker();
    const proxy = new SimWorkerProxy(worker);
    const pending = proxy.requestChores(3, 32, 16);
    const request = last('CHORES')!.command;
    expect(request).toMatchObject({ gridId: 3, thumbWidth: 32, thumbHeight: 16 });
    const summary = {
      min: 0, max: 1, mean: 0.5,
      histogram: new Uint32Array(256),
      thumb: { values: new Float32Array(512), width: 32, height: 16 },
    };
    deliver({ type: 'CHORES', seq: request.seq, summary });
    await expect(pending).resolves.toBe(summary);
  });

  it('settles pending requests with null when the worker dies, and answers null after', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { worker, deliver } = stubWorker();
    const proxy = new SimWorkerProxy(worker);
    const pending = proxy.requestChores(1, 32, 16);
    deliver({ type: 'ERROR', error: 'boom', fatal: true });
    await expect(pending).resolves.toBeNull();
    await expect(proxy.requestChores(1, 32, 16)).resolves.toBeNull();
  });
});
