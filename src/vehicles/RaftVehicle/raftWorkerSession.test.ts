import { startRaftWorkerSession, type RaftSessionProxy } from './raftWorkerSession';
import {
  registerWorkerCollider,
  resetWorkerColliderRegistry,
} from '../../physics/workerColliderRegistry';
import type { RapierWorkerInitPayload, WorkerRaftState } from '../../physics/rapierWorkerProtocol';

const STATE: WorkerRaftState = {
  position: [0, -6, -12],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  angularVelocity: [0, 0, 0],
};

/** A proxy whose INIT resolves only when the test says so. */
class FakeProxy implements RaftSessionProxy {
  disposed = 0;
  initPayload: RapierWorkerInitPayload | undefined;
  added: unknown[] = [];
  private resolveInit: ((s: WorkerRaftState) => void) | null = null;
  private rejectInit: ((e: Error) => void) | null = null;

  init(payload?: RapierWorkerInitPayload) {
    this.initPayload = payload;
    return new Promise<WorkerRaftState>((resolve, reject) => {
      this.resolveInit = resolve;
      this.rejectInit = reject;
    });
  }
  finishInit() {
    this.resolveInit?.(STATE);
  }
  failInit() {
    this.rejectInit?.(new Error('wasm blew up'));
  }
  addStaticCollider = vi.fn(async (spec: unknown) => {
    if (this.disposed) throw new Error('Rapier worker disposed');
    this.added.push(spec);
    return this.added.length;
  });
  removeStaticCollider = vi.fn(async () => {});
  applyImpulse = vi.fn(async () => {});
  connectSim = vi.fn(async () => {});
  dispose() {
    this.disposed += 1;
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function start(proxy: FakeProxy) {
  const unlink = vi.fn();
  const linkSim = vi.fn(() => unlink);
  const onReady = vi.fn();
  const onFallback = vi.fn();
  const session = startRaftWorkerSession({
    createProxy: () => proxy,
    raft: { mass: 150 },
    getRaftPosition: () => [1, -5, -30],
    linkSim,
    onReady,
    onFallback,
  });
  return { session, linkSim, unlink, onReady, onFallback };
}

describe('raft worker session (#465 C2/C3)', () => {
  beforeEach(() => resetWorkerColliderRegistry());

  it('waits for the track collider, inits at the current pose, replays colliders, then links', async () => {
    const proxy = new FakeProxy();
    const { linkSim, onReady } = start(proxy);
    await flush();
    expect(proxy.initPayload).toBeUndefined(); // no ground yet → no worker world

    registerWorkerCollider('seg:0', () => ({ halfExtents: [1, 1, 1], position: [0, -6, 0] }));
    await flush();
    expect(proxy.initPayload?.raft?.position).toEqual([1, -5, -30]);
    expect(proxy.initPayload?.staticColliders).toEqual([]);

    proxy.finishInit();
    await flush();
    expect(proxy.added).toHaveLength(1);
    expect(onReady).toHaveBeenCalledWith(proxy, STATE);
    expect(linkSim).toHaveBeenCalledWith(proxy);
  });

  it('an INIT that resolves after stop never links, never reports ready, and disposes once', async () => {
    registerWorkerCollider('seg:0', () => ({ halfExtents: [1, 1, 1], position: [0, -6, 0] }));
    const proxy = new FakeProxy();
    const { session, linkSim, onReady, onFallback } = start(proxy);
    await flush();

    session.stop();
    proxy.finishInit();
    await flush();

    expect(linkSim).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    expect(proxy.disposed).toBe(1);
    session.stop();
    expect(proxy.disposed).toBe(1);
  });

  it('a stale session (worker toggle) never disposes the next session\'s proxy', async () => {
    registerWorkerCollider('seg:0', () => ({ halfExtents: [1, 1, 1], position: [0, -6, 0] }));
    const first = new FakeProxy();
    const second = new FakeProxy();
    const a = start(first);
    await flush();
    a.session.stop();

    const b = start(second);
    await flush();
    first.failInit(); // the old INIT fails late
    second.finishInit();
    await flush();

    expect(second.disposed).toBe(0);
    expect(b.onReady).toHaveBeenCalledWith(second, STATE);
    expect(a.onFallback).not.toHaveBeenCalled();
    expect(first.disposed).toBe(1);
  });

  it('stop after ready unlinks the sim and disposes', async () => {
    registerWorkerCollider('seg:0', () => ({ halfExtents: [1, 1, 1], position: [0, -6, 0] }));
    const proxy = new FakeProxy();
    const { session, unlink } = start(proxy);
    await flush();
    proxy.finishInit();
    await flush();

    session.stop();
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(proxy.disposed).toBe(1);
  });

  it('a failed INIT falls back once and disposes its own proxy', async () => {
    registerWorkerCollider('seg:0', () => ({ halfExtents: [1, 1, 1], position: [0, -6, 0] }));
    const proxy = new FakeProxy();
    const { session, onFallback, linkSim } = start(proxy);
    await flush();
    proxy.failInit();
    await flush();

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(linkSim).not.toHaveBeenCalled();
    expect(proxy.disposed).toBe(1);
    session.stop();
    expect(proxy.disposed).toBe(1);
  });
});
