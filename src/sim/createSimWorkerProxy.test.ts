/**
 * createSimWorkerProxy — the handshake can fail every way a worker can, and
 * none of them hangs the boot (#455). No binary needed: the worker is a stub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimWorkerProxy, getSimWorkerProxy, resetSimWorkerProxyForTests } from './createSimWorkerProxy';
import type { SimWorkerCommand, SimWorkerLike, SimWorkerResponse } from './simWorkerProtocol';

type Listener = (event: { data?: SimWorkerResponse; message?: string; preventDefault?: () => void }) => void;

function stubWorker(onPost: (command: SimWorkerCommand, reply: (r: SimWorkerResponse) => void) => void = () => {}) {
  const listeners = { message: new Set<Listener>(), error: new Set<Listener>() };
  const posted: { command: SimWorkerCommand; transfer: Transferable[] }[] = [];
  const reply = (data: SimWorkerResponse) => {
    queueMicrotask(() => listeners.message.forEach((l) => l({ data })));
  };
  const worker = {
    postMessage: vi.fn((command: SimWorkerCommand, transfer: Transferable[] = []) => {
      posted.push({ command, transfer });
      onPost(command, reply);
    }),
    terminate: vi.fn(),
    addEventListener: (type: 'message' | 'error', l: Listener) => listeners[type].add(l),
    removeEventListener: (type: 'message' | 'error', l: Listener) => listeners[type].delete(l),
  };
  const scriptError = (message: string) => listeners.error.forEach((l) => l({ message, preventDefault: () => {} }));
  return { worker: worker as unknown as SimWorkerLike & typeof worker, posted, reply, scriptError };
}

afterEach(() => {
  resetSimWorkerProxyForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('getSimWorkerProxy', () => {
  it('resolves once the worker reports READY', async () => {
    const { worker } = stubWorker((c, reply) => {
      if (c.type === 'INIT') reply({ type: 'READY', abi: 11 });
    });
    const proxy = await getSimWorkerProxy(() => worker);
    expect(proxy.abi).toBe(11);
    expect(proxy.failed).toBeNull();
  });

  it('rejects when Worker construction throws, and keeps rejecting (no retry into a second worker)', async () => {
    const factory = vi.fn(() => {
      throw new Error('Worker is not a constructor');
    });
    await expect(getSimWorkerProxy(factory)).rejects.toThrow('Worker is not a constructor');
    await expect(getSimWorkerProxy(factory)).rejects.toThrow('Worker is not a constructor');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('rejects and terminates when the module fails to load in the worker', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { worker } = stubWorker((c, reply) => {
      if (c.type === 'INIT') reply({ type: 'ERROR', error: 'watershed_native failed to load', fatal: true });
    });
    await expect(getSimWorkerProxy(() => worker)).rejects.toThrow('watershed_native failed to load');
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('rejects on a worker script error (404, syntax) instead of waiting', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stub = stubWorker();
    const pending = getSimWorkerProxy(() => stub.worker);
    stub.scriptError('Failed to fetch simWorker.js');
    await expect(pending).rejects.toThrow('Failed to fetch simWorker.js');
  });

  it('rejects at the deadline when the worker never answers', async () => {
    vi.useFakeTimers();
    const proxy = new SimWorkerProxy(stubWorker().worker);
    const pending = proxy.ready(500);
    const assertion = expect(pending).rejects.toThrow('did not report READY within 500ms');
    await vi.advanceTimersByTimeAsync(501);
    await assertion;
  });
});

describe('SimWorkerProxy frames', () => {
  it('hands a frame for a grid nobody owns straight back to the worker', async () => {
    const stub = stubWorker();
    const proxy = new SimWorkerProxy(stub.worker);
    const buffer = new ArrayBuffer(64);
    stub.reply({
      type: 'FRAME',
      frame: { gridId: 99, frameIndex: 1, epoch: 0, width: 2, height: 2, computeMicros: 5, backend: 'wasm-worker', inflow: null, bed: true, buffer },
    });
    await Promise.resolve();
    expect(proxy.latestFrame()).toMatchObject({ gridId: 99, frameIndex: 1, computeMicros: 5 });
    const returned = stub.posted.find((p) => p.command.type === 'RETURN_FRAME');
    expect(returned?.transfer).toEqual([buffer]);
  });

  it('tells fatal listeners once and stops posting after the worker dies', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stub = stubWorker();
    const proxy = new SimWorkerProxy(stub.worker);
    const onFatal = vi.fn();
    proxy.onFatal(onFatal);
    stub.reply({ type: 'ERROR', error: 'RuntimeError: unreachable', fatal: true });
    stub.reply({ type: 'ERROR', error: 'again', fatal: true });
    await Promise.resolve();
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(proxy.failed).toBe('RuntimeError: unreachable');
    const before = stub.posted.length;
    proxy.post({ type: 'DISPOSE_GRID', gridId: 1 });
    expect(stub.posted.length).toBe(before);
  });
});

describe('SimWorkerProxy forces and the hull link (Phase B)', () => {
  it('transfers the sample buffer, numbers requests, and hands results to the one listener', async () => {
    const stub = stubWorker();
    const proxy = new SimWorkerProxy(stub.worker);
    const onForces = vi.fn();
    proxy.onForces(onForces);
    const samples = new Float64Array(17);
    const seq = proxy.requestForces(3, -1, 2, samples, 1);
    const posted = stub.posted.at(-1)!;
    expect(posted.command).toMatchObject({ type: 'FORCES', seq, gridId: 3, originX: -1, originZ: 2, count: 1 });
    expect(posted.transfer).toEqual([samples.buffer]);
    expect(proxy.requestForces(3, 0, 0, new Float64Array(17), 1)).toBe(seq! + 1);

    stub.reply({ type: 'FORCES', seq: seq!, count: 1, results: samples, calls: 1, computeMicros: 9 });
    await Promise.resolve();
    expect(onForces).toHaveBeenCalledWith({ seq, count: 1, results: samples, calls: 1, computeMicros: 9 });
  });

  it('sends nothing once the worker is dead', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stub = stubWorker();
    const proxy = new SimWorkerProxy(stub.worker);
    stub.reply({ type: 'ERROR', error: 'gone', fatal: true });
    await Promise.resolve();
    expect(proxy.requestForces(1, 0, 0, new Float64Array(17), 1)).toBeNull();
  });

  it('transfers its end of the hull link', () => {
    const stub = stubWorker();
    const proxy = new SimWorkerProxy(stub.worker);
    const port = {} as MessagePort;
    proxy.connectPhysics(port);
    expect(stub.posted.at(-1)).toEqual({ command: { type: 'CONNECT_PHYSICS', port }, transfer: [port] });
  });
});

describe('SimWorkerProxy.requestTile (#487 B)', () => {
  const spec = {
    segmentId: 4,
    path: { points: [0, 0, 0, 0, 0, -10, 0, 0, -20, 0, 0, -30], closed: false, curveType: 'catmullrom' as const, tension: 0.5 },
    canyonWidth: 30,
    waterWidth: 12,
    biome: 'canyonSummer',
    channelProfile: [],
    isSlotCanyon: false,
    isGlacier: false,
    biomeProfile: { id: 'canyonSummer' as const, wallHeight: 15 },
    tubeProfile: null,
  };

  it('pairs each TILE with its request by seq', async () => {
    const { worker } = stubWorker((c, reply) => {
      if (c.type === 'BUILD_TILE') {
        reply({ type: 'TILE', seq: c.seq, meshes: null, error: `segment ${c.spec.segmentId}`, buildMicros: c.seq });
      }
    });
    const proxy = new SimWorkerProxy(worker);
    const [a, b] = await Promise.all([proxy.requestTile(spec), proxy.requestTile({ ...spec, segmentId: 5 })]);
    expect(a).toMatchObject({ seq: 1, error: 'segment 4' });
    expect(b).toMatchObject({ seq: 2, error: 'segment 5' });
  });

  it('settles pending tiles with null when the worker dies, and answers null after', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stub = stubWorker();
    const proxy = new SimWorkerProxy(stub.worker);
    const pending = proxy.requestTile(spec);
    stub.scriptError('worker crashed');
    await expect(pending).resolves.toBeNull();
    await expect(proxy.requestTile(spec)).resolves.toBeNull();
  });
});
