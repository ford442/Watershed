/**
 * waterForceAuthority.ts — two water-force paths, one owner per body per tick (#467).
 *
 *   'sim-worker'  forces.cpp in the sim worker, sampling the SWE field it steps:
 *                 debris and a main-thread vehicle through WaterForceSystem's
 *                 batch (simForces.ts), the Rapier worker's raft through the
 *                 hull link (hullLinkProtocol.ts).
 *   'ts-mirror'   calculateWaterForceFallback (waterForceFallback.ts) on the
 *                 main thread: `?simWorker=0`, native-WebGPU / no-WASM boots, a
 *                 sim worker that never came up or died, and the hull's first
 *                 ticks before the link answers.
 *
 * There is no third path. The main thread no longer calls forces.cpp itself
 * (its module, when it has one, only steps the SWE field), the raft no longer
 * applies its own force, and the Rapier worker computes nothing: it applies the
 * hull link's force when that is fresh and otherwise the mirror force the main
 * thread computed for the same state and sent with the step (pickHullForce).
 *
 * Authored WaterFlowForces *currents* are gated off while WaterForceSystem is
 * active (SWE u,w drives the forces). Centering / seating / alignment stay
 * separate. Vortex *impulses* remain until a hydroEvent vortex owns that
 * segment's SWE sink.
 */

import type { WaterForceDiagnostics } from './rapierWorkerProtocol';

export type WaterForceOwner = 'sim-worker' | 'ts-mirror';

/** Force (N) → Rapier impulse per second, shared by every path. */
export const WATER_FORCE_IMPULSE_SCALE = 0.001;

/**
 * Who computes this frame's forces for the bodies WaterForceSystem owns
 * (debris, and the vehicle while the main thread holds it): the sim worker
 * while it is up and answering, otherwise the TS mirror.
 */
export function resolveWaterForceOwner(opts: { simWorkerForces: boolean }): WaterForceOwner {
  return opts.simWorkerForces ? 'sim-worker' : 'ts-mirror';
}

/**
 * The Rapier worker's raft force for one tick: the sim worker's (hull link),
 * when it has a fresh one, else the mirror force the main thread sent with the
 * step. Exactly one is applied; null means neither exists (water forces off).
 */
export function pickHullForce(
  fromSim: WaterForceDiagnostics | null,
  mirror: WaterForceDiagnostics | null | undefined,
): { owner: WaterForceOwner; force: WaterForceDiagnostics } | null {
  if (fromSim) return { owner: 'sim-worker', force: fromSim };
  if (mirror) return { owner: 'ts-mirror', force: mirror };
  return null;
}

/**
 * Authored `VortexConfig` impulses are the *fallback* swirl. When a live
 * hydroEvent vortex writes that segment's SWE `u,w`, the hull already feels
 * the swirl through sampleSWEFlow → calculateWaterForce, so adding the Rapier
 * centripetal impulse on top double-applies one field.
 */
export function shouldApplyAuthoredVortexImpulse(
  segmentIndex: number | undefined,
  liveHydroVortexSegments: ReadonlySet<number>,
): boolean {
  if (segmentIndex === undefined || !Number.isFinite(segmentIndex)) return true;
  return !liveHydroVortexSegments.has(segmentIndex);
}
