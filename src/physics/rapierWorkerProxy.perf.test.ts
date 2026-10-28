/**
 * Perf project (`pnpm test:perf`): the proxy's own overhead on a loopback
 * worker stays under 2 ms per round trip. Wall-time budgets live here, not in
 * the correctness suite, because a loaded box (CI neighbours, a laptop on
 * battery) fails them without anything being wrong.
 */
import { RapierWorkerProxy } from './RapierWorkerProxy';
import { LoopbackRapierWorker } from './__tests__/loopbackRapierWorker';

describe('RapierWorkerProxy latency', () => {
  it('round-trips init, impulse, step and state under 2 ms on loopback', async () => {
    const proxy = new RapierWorkerProxy(new LoopbackRapierWorker());
    await proxy.init({
      raft: {
        position: [0, -4, -10],
        halfExtents: [1, 0.15, 1.5],
        mass: 150,
        linearDamping: 2,
        angularDamping: 2.5,
      },
      staticColliders: [],
    });
    for (let i = 0; i < 20; i += 1) {
      await proxy.applyImpulse([0, 0, -1]);
      await proxy.step(1 / 60, { impulses: [] });
      await proxy.getState();
    }
    expect(proxy.averageLatencyMs).toBeLessThan(2);
    proxy.dispose();
  });
});
