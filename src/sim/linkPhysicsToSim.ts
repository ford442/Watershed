/**
 * linkPhysicsToSim — hand the Rapier worker and the sim worker the two ends of
 * a MessageChannel (#455 Phase B), so the raft's hull state and its water force
 * travel worker-to-worker without a main-thread hop (hullLinkProtocol.ts).
 *
 * Only on the `wasm-worker` backend, and only once the sim worker is READY; a
 * failed handshake leaves the Rapier worker unlinked (TS fallback on the tick
 * params WaterForceSystem samples on the main thread, as before Phase B).
 */
import { resolveSweSimBackendDecision } from '../systems/water/sweBackend';
import { getSimWorkerProxy } from './createSimWorkerProxy';

/** The Rapier side of the link (RapierWorkerProxy.connectSim). */
export interface SimLinkablePhysics {
  connectSim(port: MessagePort): Promise<void>;
}

/** Link once both workers are up. Returns a cancel for an unmount before that. */
export function linkPhysicsToSim(physics: SimLinkablePhysics): () => void {
  if (typeof MessageChannel === 'undefined') return () => {};
  if (resolveSweSimBackendDecision().backend !== 'wasm-worker') return () => {};
  let cancelled = false;
  getSimWorkerProxy().then(
    (sim) => {
      if (cancelled || sim.failed) return;
      const channel = new MessageChannel();
      sim.connectPhysics(channel.port1);
      physics.connectSim(channel.port2).catch((error) => {
        console.warn('[sim worker] hull link to the Rapier worker failed; raft uses TS water forces', error);
      });
    },
    () => {
      /* failed handshake: WaterForceSystem reports it and stays on the main thread */
    },
  );
  return () => {
    cancelled = true;
  };
}
