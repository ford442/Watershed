/**
 * linkPhysicsToSim — the MessageChannel handoff between the two workers (#455
 * Phase B): only on wasm-worker, only after READY, never after an unmount.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../systems/water/sweBackend', () => ({
  resolveSweSimBackendDecision: vi.fn(() => ({ backend: 'wasm-worker', reason: 'no-webgpu-device' })),
}));
vi.mock('./createSimWorkerProxy', () => ({ getSimWorkerProxy: vi.fn() }));

import { resolveSweSimBackendDecision } from '../systems/water/sweBackend';
import { getSimWorkerProxy, type SimWorkerProxy } from './createSimWorkerProxy';
import { linkPhysicsToSim } from './linkPhysicsToSim';

function simStub(failed: string | null = null) {
  return { failed, connectPhysics: vi.fn() } as unknown as SimWorkerProxy & { connectPhysics: ReturnType<typeof vi.fn> };
}

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('linkPhysicsToSim', () => {
  it('gives each worker one end of a channel once the sim worker is READY', async () => {
    const sim = simStub();
    vi.mocked(getSimWorkerProxy).mockResolvedValue(sim);
    const physics = { connectSim: vi.fn(() => Promise.resolve()) };
    linkPhysicsToSim(physics);
    await flush();
    expect(sim.connectPhysics).toHaveBeenCalledTimes(1);
    expect(physics.connectSim).toHaveBeenCalledTimes(1);
    const [simPort] = sim.connectPhysics.mock.calls[0];
    const [physicsPort] = physics.connectSim.mock.calls[0] as unknown as [MessagePort];
    expect(simPort).not.toBe(physicsPort);
    (simPort as MessagePort).close();
  });

  it('does nothing off the wasm-worker backend, after a failed handshake, or after cancel', async () => {
    const physics = { connectSim: vi.fn(() => Promise.resolve()) };

    vi.mocked(resolveSweSimBackendDecision).mockReturnValueOnce({ backend: 'wgsl', reason: 'native-webgpu' });
    linkPhysicsToSim(physics);
    expect(getSimWorkerProxy).not.toHaveBeenCalled();

    vi.mocked(getSimWorkerProxy).mockRejectedValueOnce(new Error('sim worker did not report READY'));
    linkPhysicsToSim(physics);
    await flush();

    const sim = simStub();
    vi.mocked(getSimWorkerProxy).mockResolvedValueOnce(sim);
    const cancel = linkPhysicsToSim(physics);
    cancel();
    await flush();

    expect(sim.connectPhysics).not.toHaveBeenCalled();
    expect(physics.connectSim).not.toHaveBeenCalled();
  });
});
