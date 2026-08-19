/**
 * Shared water-force tick helpers for the physics worker (ADR v1).
 *
 * Tick order when worker path is enabled:
 *   1. Read Rapier raft state
 *   2. Pack 8-float input stride
 *   3. computeWaterForcesBatch (or TS fallback)
 *   4. Apply force * dt * impulseScale impulses
 *   5. Apply external impulses (paddle, etc.)
 *   6. world.step()
 *   7. Post body snapshot + diagnostics to render thread
 */

import {
  WATER_FORCE_INPUT_STRIDE,
  WATER_FORCE_OUTPUT_STRIDE,
  calculateWaterForceFallback,
  type NativeWaterForceConfig,
  type WatershedNativeModule,
} from '../systems/water/WatershedWasm';
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
}

export interface PhysicsWorkerWaterBatch {
  inputPtr: number;
  outputPtr: number;
  input: Float32Array;
  output: Float32Array;
}

export interface RapierImpulseBody {
  applyImpulse(impulse: { x: number; y: number; z: number }, wake?: boolean): void;
}

export function createPhysicsWorkerWaterBatch(
  mod: WatershedNativeModule,
): PhysicsWorkerWaterBatch {
  const inputPtr = mod.allocateGrid(WATER_FORCE_INPUT_STRIDE);
  const outputPtr = mod.allocateGrid(WATER_FORCE_OUTPUT_STRIDE);
  return {
    inputPtr,
    outputPtr,
    input: new Float32Array(mod.HEAPF32.buffer, inputPtr, WATER_FORCE_INPUT_STRIDE),
    output: new Float32Array(mod.HEAPF32.buffer, outputPtr, WATER_FORCE_OUTPUT_STRIDE),
  };
}

export function disposePhysicsWorkerWaterBatch(
  mod: WatershedNativeModule,
  batch: PhysicsWorkerWaterBatch,
): void {
  mod.freeGrid(batch.inputPtr);
  mod.freeGrid(batch.outputPtr);
}

export function packRaftWaterSample(
  state: WorkerRaftState,
  flowDirX: number,
  flowDirZ: number,
  input: Float32Array,
): void {
  input[0] = state.position[0];
  input[1] = state.position[1];
  input[2] = state.position[2];
  input[3] = state.velocity[0];
  input[4] = state.velocity[1];
  input[5] = state.velocity[2];
  input[6] = flowDirX;
  input[7] = flowDirZ;
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
  output: Float32Array,
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

export function computePhysicsWorkerWaterForces(
  wasm: WatershedNativeModule | null,
  batch: PhysicsWorkerWaterBatch,
  state: WorkerRaftState,
  config: PhysicsWorkerWaterTickConfig,
): WaterForceDiagnostics {
  if (!config.enabled) {
    return {
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
  }

  packRaftWaterSample(state, config.flowDirX, config.flowDirZ, batch.input);
  const nativeConfig = toNativeWaterForceConfig(config);
  const startedAt = now();

  if (wasm) {
    wasm.computeWaterForcesBatch(
      batch.inputPtr,
      batch.outputPtr,
      1,
      nativeConfig.flowSpeed,
      nativeConfig.waterLevel,
      nativeConfig.raftMass,
      nativeConfig.raftVolume,
      nativeConfig.dragCoefficient,
      nativeConfig.frontalArea,
      nativeConfig.sideArea,
      nativeConfig.timeSeconds,
      nativeConfig.turbulenceStrength,
      nativeConfig.turbulenceFrequency,
    );
    return readWaterForceDiagnostics(batch.output, 'wasm', (now() - startedAt) * 1000);
  }

  const fallback = calculateWaterForceFallback(
    {
      position: { x: state.position[0], y: state.position[1], z: state.position[2] },
      velocity: { x: state.velocity[0], y: state.velocity[1], z: state.velocity[2] },
      flowDirection: { x: config.flowDirX, z: config.flowDirZ },
    },
    nativeConfig,
  );

  batch.output[0] = fallback.forceX;
  batch.output[1] = fallback.forceY;
  batch.output[2] = fallback.forceZ;
  batch.output[3] = fallback.buoyancy;
  batch.output[4] = fallback.drag;
  batch.output[5] = fallback.flow;
  batch.output[6] = fallback.turbulence;
  batch.output[7] = fallback.submergedRatio;

  return readWaterForceDiagnostics(batch.output, 'fallback', (now() - startedAt) * 1000);
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
