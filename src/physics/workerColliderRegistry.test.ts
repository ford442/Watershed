import {
  attachColliderRegistry,
  registerWorkerCollider,
  resetWorkerColliderRegistry,
  unregisterWorkerCollider,
  whenWorkerColliderRegistered,
  type StaticColliderSink,
} from './workerColliderRegistry';
import type { StaticColliderSpec } from './rapierWorkerProtocol';

const box = (y: number): StaticColliderSpec => ({ halfExtents: [1, 1, 1], position: [0, y, 0] });

function fakeSink() {
  let next = 1;
  const live = new Map<number, StaticColliderSpec>();
  const sink: StaticColliderSink & { live: typeof live } = {
    live,
    addStaticCollider: vi.fn(async (spec: StaticColliderSpec) => {
      const handle = next++;
      live.set(handle, spec);
      return handle;
    }),
    removeStaticCollider: vi.fn(async (handle: number) => {
      live.delete(handle);
    }),
  };
  return sink;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('workerColliderRegistry (#465 C2)', () => {
  afterEach(() => resetWorkerColliderRegistry());

  it('replays what is already registered, then streams adds and removes', async () => {
    registerWorkerCollider('seg:1', () => box(-6));
    registerWorkerCollider('rock:a:0', () => box(-7));

    const sink = fakeSink();
    const attachment = attachColliderRegistry(sink);
    await attachment.settled();
    expect(sink.live.size).toBe(2);

    registerWorkerCollider('seg:2', () => box(-20));
    unregisterWorkerCollider('seg:1');
    await attachment.settled();
    await flush();

    expect([...sink.live.values()].map((s) => (s.kind === 'trimesh' ? 0 : s.position[1])).sort()).toEqual([-20, -7]);
  });

  it('replaces a key in place instead of stacking a second body', async () => {
    const sink = fakeSink();
    const attachment = attachColliderRegistry(sink);
    registerWorkerCollider('trestle:3:0', () => box(1));
    registerWorkerCollider('trestle:3:0', () => box(2));
    await attachment.settled();
    await flush();
    expect(sink.live.size).toBe(1);
    expect([...sink.live.values()][0]).toMatchObject({ position: [0, 2, 0] });
  });

  it('builds specs lazily — nothing is copied while no worker is attached', () => {
    const build = vi.fn(() => box(0));
    registerWorkerCollider('seg:9', build);
    expect(build).not.toHaveBeenCalled();
  });

  it('stops streaming after detach and swallows a disposed proxy', async () => {
    const sink = fakeSink();
    const attachment = attachColliderRegistry(sink);
    attachment.detach();
    registerWorkerCollider('seg:4', () => box(0));
    await flush();
    expect(sink.addStaticCollider).not.toHaveBeenCalled();

    const failing: StaticColliderSink = {
      addStaticCollider: () => Promise.reject(new Error('Rapier worker disposed')),
      removeStaticCollider: () => Promise.reject(new Error('Rapier worker disposed')),
    };
    const second = attachColliderRegistry(failing);
    second.detach();
    await expect(second.settled()).resolves.toBeUndefined();
  });

  it('whenWorkerColliderRegistered resolves on the first matching key', async () => {
    const wait = whenWorkerColliderRegistered('seg:');
    let resolved = false;
    void wait.promise.then(() => {
      resolved = true;
    });
    registerWorkerCollider('rock:x:0', () => box(0));
    await flush();
    expect(resolved).toBe(false);
    registerWorkerCollider('seg:12', () => box(0));
    await flush();
    expect(resolved).toBe(true);
  });
});
