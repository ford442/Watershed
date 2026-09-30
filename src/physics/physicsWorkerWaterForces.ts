/**
 * Shared water-force tick helpers for the physics worker (ADR v1, #455 Phase B).
 *
 * The Rapier worker no longer loads watershed_native: the raft's native force
 * is computed by the sim worker, on the SWE field it steps, and reaches this
 * worker over the hull link (src/sim/hullLinkProtocol.ts). Tick order when the
 * worker path is enabled:
 *   1. Take the latest HULL_FORCE from the sim worker (computed from the state
 *      posted after the previous tick) — or, without a live link, the TS
 *      fallback on the tick params (calculateWaterForceFallback)
 *   2. Apply force * dt * impulseScale impulses
 *   3. Apply external impulses (paddle, etc.)
 *   4. world.step()
 *   5. Post HULL (post-step state) to the sim worker; post the body snapshot +
 *      diagnostics to the render thread
 */

import {
  WATER_FORCE_OUTPUT_STRIDE,
  calculateWaterForceFallback,
  type NativeWaterForceConfig,
} from '../systems/water/WatershedWasm';
import { FORCE_SAMPLE_STRIDE, readForceFlow, readForceResult, writeForceSample } from '../sim/simForces';
import type { Vec3Tuple, WorkerRaftState } from './rapierWorkerProtocol';
import type { WaterForceDiagnostics } from './physicsWorkerRegistry';

/** High-resolution clock, degrading to Date.now where performance is absent. */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Matches WaterForceSystem impulse scaling to Rapier game units. */
export const PHYSICS_WORKER_IMPULSE_SCALE = 0.001;

export interface PhysicsWorkerWaterTickConfig {
  enabled: boolean;
  flowSpeed: number;
  waterLevel: number;
  raftMass: number;
  raftVolume: number;
  dragCoefficient: number;
  frontalArea: number;
  sideArea: number;
  timeSeconds: number;
  turbulenceStrength: number;
  turbulenceFrequency: number;
  flowDirX: number;
  flowDirZ: number;
  impulseScale?: number;
  /** flowSpeed / waterLevel are authored; the sim worker samples the flow (hull link). */
  simFlow?: boolean;
}

export interface RapierImpulseBody {
  applyImpulse(impulse: { x: number; y: number; z: number }, wake?: boolean): void;
}

export function toNativeWaterForceConfig(
  config: PhysicsWorkerWaterTickConfig,
): NativeWaterForceConfig {
  return {
    flowSpeed: config.flowSpeed,
    waterLevel: config.waterLevel,
    raftMass: config.raftMass,
    raftVolume: config.raftVolume,
    dragCoefficient: config.dragCoefficient,
    frontalArea: config.frontalArea,
    sideArea: config.sideArea,
    timeSeconds: config.timeSeconds,
    turbulenceStrength: config.turbulenceStrength,
    turbulenceFrequency: config.turbulenceFrequency,
  };
}

export function readWaterForceDiagnostics(
  output: ArrayLike<number>,
  source: WaterForceDiagnostics['source'],
  computeMicros?: number,
): WaterForceDiagnostics {
  return {
    source,
    ...(computeMicros === undefined ? {} : { computeMicros }),
    forceX: output[0],
    forceY: output[1],
    forceZ: output[2],
    buoyancy: output[3],
    drag: output[4],
    flow: output[5],
    turbulence: output[6],
    submergedRatio: output[7],
  };
}

const DISABLED: WaterForceDiagnostics = {
  source: 'disabled',
  forceX: 0,
  forceY: 0,
  forceZ: 0,
  buoyancy: 0,
  drag: 0,
  flow: 0,
  turbulence: 0,
  submergedRatio: 0,
};

/**
 * The raft force when the sim worker's is not available this tick: the TS
 * twin of forces.cpp on the tick params (which the main thread sampled, or the
 * authored flow when `simFlow` is set and the link is down).
 */
export function computePhysicsWorkerWaterForces(
  state: WorkerRaftState,
  config: PhysicsWorkerWaterTickConfig,
): WaterForceDiagnostics {
  if (!config.enabled) return { ...DISABLED };

  const startedAt = now();
  const fallback = calculateWaterForceFallback(
    {
      position: { x: state.position[0], y: state.position[1], z: state.position[2] },
      velocity: { x: state.velocity[0], y: state.velocity[1], z: state.velocity[2] },
      flowDirection: { x: config.flowDirX, z: config.flowDirZ },
    },
    toNativeWaterForceConfig(config),
  );
  const output = [
    fallback.forceX,
    fallback.forceY,
    fallback.forceZ,
    fallback.buoyancy,
    fallback.drag,
    fallback.flow,
    fallback.turbulence,
    fallback.submergedRatio,
  ];
  return readWaterForceDiagnostics(output, 'fallback', (now() - startedAt) * 1000);
}

/**
 * The hull sample the Rapier worker posts to the sim worker after a step: the
 * post-step raft state and the tick's authored config (simForces.ts wire format).
 */
export function hullSampleFromState(
  state: WorkerRaftState,
  config: PhysicsWorkerWaterTickConfig,
  out: Float64Array = new Float64Array(FORCE_SAMPLE_STRIDE),
): Float64Array {
  writeForceSample(
    out,
    0,
    {
      position: { x: state.position[0], y: state.position[1], z: state.position[2] },
      velocity: { x: state.velocity[0], y: state.velocity[1], z: state.velocity[2] },
    },
    toNativeWaterForceConfig(config),
    config.flowSpeed,
    1,
  );
  return out;
}

/** Diagnostics for a force the sim worker computed (one simForces.ts result). */
export function diagnosticsFromHullResult(result: Float64Array, computeMicros: number): WaterForceDiagnostics {
  const force = readForceResult(result, 0);
  const output = new Array<number>(WATER_FORCE_OUTPUT_STRIDE);
  output[0] = force.forceX;
  output[1] = force.forceY;
  output[2] = force.forceZ;
  output[3] = force.buoyancy;
  output[4] = force.drag;
  output[5] = force.flow;
  output[6] = force.turbulence;
  output[7] = force.submergedRatio;
  return { ...readWaterForceDiagnostics(output, 'wasm', computeMicros), sampledFlow: readForceFlow(result, 0) };
}

export function applyWaterForceImpulse(
  body: RapierImpulseBody,
  diagnostics: WaterForceDiagnostics,
  delta: number,
  impulseScale = PHYSICS_WORKER_IMPULSE_SCALE,
): void {
  if (diagnostics.source === 'disabled' || diagnostics.submergedRatio <= 0) return;

  body.applyImpulse(
    {
      x: diagnostics.forceX * delta * impulseScale,
      y: diagnostics.forceY * delta * impulseScale,
      z: diagnostics.forceZ * delta * impulseScale,
    },
    true,
  );
}

export function applyImpulseList(
  body: RapierImpulseBody,
  impulses: Vec3Tuple[],
): void {
  for (const [x, y, z] of impulses) {
    body.applyImpulse({ x, y, z }, true);
  }
}
