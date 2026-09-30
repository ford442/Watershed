/**
 * hullLinkClient — the Rapier worker's side of the hull link (#455 Phase B).
 * A fake port stands in for the MessageChannel; the real-port round trip
 * against the real binary is in src/sim/simWorker.integration.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHullLinkClient, type RapierHullPort } from './hullLinkClient';
import { FORCE_RESULT_STRIDE, FORCE_SAMPLE_STRIDE } from '../sim/simForces';
import { HULL_FORCE_MAX_AGE, type HullLinkToPhysics, type HullLinkToSim } from '../sim/hullLinkProtocol';
import type { WorkerRaftState } from './rapierWorkerProtocol';

function fakePort() {
  const listeners = new Set<(event: MessageEvent<HullLinkToPhysics>) => void>();
  const sent: { message: HullLinkToSim; transfer?: Transferable[] }[] = [];
  const port = {
    postMessage: vi.fn((message: HullLinkToSim, transfer?: Transferable[]) => sent.push({ message, transfer })),
    addEventListener: (_: 'message', l: (event: MessageEvent<HullLinkToPhysics>) => void) => listeners.add(l),
    removeEventListener: (_: 'message', l: (event: MessageEvent<HullLinkToPhysics>) => void) => listeners.delete(l),
    start: vi.fn(),
    close: vi.fn(),
  };
  const answer = (seq: number, forceY: number) => {
    const result = new Float64Array(FORCE_RESULT_STRIDE);
    result.set([0, forceY, 0, 0, 0, 0, 0, 1, 0, -1, 1.2, 0, 1, 3]);
    for (const l of listeners) l({ data: { type: 'HULL_FORCE', seq, result, computeMicros: 4 } } as MessageEvent<HullLinkToPhysics>);
  };
  return { port: port as unknown as RapierHullPort & typeof port, sent, answer, listeners };
}

const STATE: WorkerRaftState = {
  position: [1, 0.4, -3],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, -2],
  angularVelocity: [0, 0, 0],
};
const TICK = {
  enabled: true, flowSpeed: 1.2, waterLevel: 0.5, raftMass: 150, raftVolume: 1.2, dragCoefficient: 0.47,
  frontalArea: 1.05, sideArea: 0.7, timeSeconds: 2, turbulenceStrength: 0.1, turbulenceFrequency: 2.4,
  flowDirX: 0, flowDirZ: -1, simFlow: true,
};

describe('createHullLinkClient', () => {
  it('posts the post-step hull as one transferred sample, numbered per tick', () => {
    const { port, sent } = fakePort();
    const client = createHullLinkClient(port);
    expect(port.start).toHaveBeenCalled();
    client.postHull(STATE, TICK);
    client.postHull(STATE, TICK);
    expect(sent.map((s) => s.message.seq)).toEqual([1, 2]);
    expect(sent[0].message.sample).toHaveLength(FORCE_SAMPLE_STRIDE);
    expect(sent[0].transfer).toEqual([sent[0].message.sample.buffer]);
    expect(Array.from(sent[0].message.sample.subarray(0, 9))).toEqual([1, 0.4, -3, 0, 0, -2, 1.2, 1, 0.5]);
  });

  it('has no force until the sim worker answers, then the newest one', () => {
    const { port, answer } = fakePort();
    const client = createHullLinkClient(port);
    expect(client.latestForce()).toBeNull();
    client.postHull(STATE, TICK);
    client.postHull(STATE, TICK);
    answer(2, 900);
    answer(1, 100); // out of order: older than what we hold, ignored
    expect(client.latestForce()).toMatchObject({ source: 'wasm', forceY: 900, computeMicros: 4 });
    expect(client.latestForce()?.sampledFlow).toMatchObject({ dirZ: -1, speed: 1.2, wet: true, source: 'swe' });
  });

  it('drops a force that trails the latest hull by more than the max age (dead or stalled sim worker)', () => {
    const { port, answer } = fakePort();
    const client = createHullLinkClient(port);
    client.postHull(STATE, TICK);
    answer(1, 500);
    for (let i = 0; i < HULL_FORCE_MAX_AGE; i += 1) client.postHull(STATE, TICK);
    expect(client.latestForce()?.forceY).toBe(500);
    client.postHull(STATE, TICK);
    expect(client.latestForce()).toBeNull();
  });

  it('closes the port and stops listening', () => {
    const { port, listeners } = fakePort();
    const client = createHullLinkClient(port);
    client.close();
    expect(port.close).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});
