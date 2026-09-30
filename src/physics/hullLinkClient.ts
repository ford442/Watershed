/**
 * hullLinkClient — the Rapier worker's end of the hull link (#455 Phase B).
 *
 * After each step the worker posts the raft's state (HULL); the sim worker
 * answers with the force on its live field (HULL_FORCE), which the next tick
 * applies. A result that trails the latest post by more than
 * HULL_FORCE_MAX_AGE ticks is stale — the sim worker died or stalled — and the
 * tick falls back to the TS math. See src/sim/hullLinkProtocol.ts.
 *
 * Pure over the port, so it is tested without a worker.
 */
import {
  HULL_FORCE_MAX_AGE,
  type HullLinkPort,
  type HullLinkToPhysics,
  type HullLinkToSim,
} from '../sim/hullLinkProtocol';
import { diagnosticsFromHullResult, hullSampleFromState, type PhysicsWorkerWaterTickConfig } from './physicsWorkerWaterForces';
import type { WaterForceDiagnostics } from './physicsWorkerRegistry';
import type { WorkerRaftState } from './rapierWorkerProtocol';

export type RapierHullPort = HullLinkPort<HullLinkToPhysics, HullLinkToSim>;

export interface HullLinkClient {
  /** The sim worker's force for this tick, or null (no result yet, or stale). */
  latestForce(): WaterForceDiagnostics | null;
  /** Post the post-step hull state for the next tick's force. */
  postHull(state: WorkerRaftState, config: PhysicsWorkerWaterTickConfig): void;
  close(): void;
}

export function createHullLinkClient(port: RapierHullPort): HullLinkClient {
  let postedSeq = 0;
  let latestSeq = 0;
  let latest: WaterForceDiagnostics | null = null;

  const onMessage = (event: MessageEvent<HullLinkToPhysics>) => {
    const message = event.data;
    if (message?.type !== 'HULL_FORCE' || message.seq <= latestSeq) return;
    latestSeq = message.seq;
    latest = diagnosticsFromHullResult(message.result, message.computeMicros);
  };
  port.addEventListener('message', onMessage);
  port.start?.();

  return {
    latestForce() {
      if (!latest || postedSeq - latestSeq > HULL_FORCE_MAX_AGE) return null;
      return latest;
    },
    postHull(state, config) {
      postedSeq += 1;
      const sample = hullSampleFromState(state, config);
      port.postMessage({ type: 'HULL', seq: postedSeq, sample }, [sample.buffer]);
    },
    close() {
      port.removeEventListener('message', onMessage);
      port.close?.();
      latest = null;
    },
  };
}
