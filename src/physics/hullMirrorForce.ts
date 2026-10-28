/**
 * hullMirrorForce — the TS mirror's force for the Rapier worker's raft (#467).
 *
 * Main thread only. RaftVehicle computes it from the raft state it mirrors from
 * the worker (the post-step state of the previous step — the state the next
 * step starts from, since steps are serialized) and sends it with the step as
 * `waterForce.mirror`. The worker applies it whenever the hull link has no
 * fresh sim-worker force (waterForceAuthority.ts pickHullForce), so the TS math
 * runs on one thread and the Rapier worker computes no force at all.
 */

import { telemetryNowMs } from '../utils/wallClock';
import { calculateWaterForceFallback } from '../systems/water/waterForceFallback';
import { readWaterForceDiagnostics, toNativeWaterForceConfig, DISABLED_WATER_FORCE, type PhysicsWorkerWaterTickConfig } from './physicsWorkerWaterForces';
import type { WaterForceDiagnostics } from './physicsWorkerRegistry';

export interface HullMirrorState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

/** Compute-time telemetry clock (never fed back into the force). */
const now = telemetryNowMs;

/** calculateWaterForceFallback on the tick params, as WaterForceDiagnostics ('fallback'). */
export function computeHullMirrorForce(
  state: HullMirrorState,
  config: PhysicsWorkerWaterTickConfig,
): WaterForceDiagnostics {
  if (!config.enabled) return { ...DISABLED_WATER_FORCE };

  const startedAt = now();
  const force = calculateWaterForceFallback(
    {
      position: state.position,
      velocity: state.velocity,
      flowDirection: { x: config.flowDirX, z: config.flowDirZ },
    },
    toNativeWaterForceConfig(config),
  );
  return readWaterForceDiagnostics(
    [
      force.forceX,
      force.forceY,
      force.forceZ,
      force.buoyancy,
      force.drag,
      force.flow,
      force.turbulence,
      force.submergedRatio,
    ],
    'fallback',
    (now() - startedAt) * 1000,
  );
}
