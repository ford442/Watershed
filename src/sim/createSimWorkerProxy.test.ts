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
      frame: { gridId: 99, frameIndex: 1, epoch: 0, width: 2, height: 2, computeMicros: 5, backend: 'wasm-worker', buffer },
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
