/**
 * debugTaps — the one place production code leaves diagnostics for a harness (#535 C).
 *
 * Production modules used to write `window.__watershed*` globals directly (eleven of them,
 * mostly untyped `(window as any)` writes). They now set a typed tap here: a plain module
 * object, no `window`, no `__watershed` string in the entry chunk. The harness
 * (`src/harness/debugApi.ts`, a lazy chunk loaded only when `queryFlags().debugGlobals`)
 * publishes the taps as one `window.__watershed` object for the verification scripts and
 * the console. ESLint bans `window.__*` outside `src/harness/`.
 *
 * A tap is a reference, so setting one is free; a writer that has to *build* its readout
 * (a fresh object, a reduce over the pool) checks `debugTapsEnabled()` first.
 */
import { queryFlags } from '../config/queryFlags';
import type { PhysicsDebugSnapshot } from '../vehicles/RunnerVehicle/constants';

export interface CameraDiagTap {
  uuid: string;
  pos: { x: number; y: number; z: number };
  quat: { x: number; y: number; z: number; w: number };
  matrixWorld: number[];
}

export interface WaterForceTap {
  status: string;
  origin: { x: number; z: number } | null;
  sampleCount: number;
  sweBudget: unknown;
  workerOwnsVehicleForces: boolean;
  forcesIn: string;
  forcesInFlight: number;
  sampledDir: [number, number];
  sampledSpeed: number;
  stage: number;
  stagedWaterLevel: number;
  fallbackDir: [number, number];
  source: string;
  wet: boolean;
  workerDiagnostics: unknown;
}

export interface ObstaclePoolTap {
  size: number;
  active: number;
  types: Record<string, number>;
}

export interface PhysicsWorkerTap {
  simLinked: boolean;
  waterForce: unknown;
  tickOrder: string[];
}

export interface DebugTaps {
  /** The runner's last physics step (RunnerPhysicsStep, PhysicsDebugOverlay). */
  physicsDebug?: PhysicsDebugSnapshot;
  /** PhysicsPerfMonitor's rolling step timings (verification/physics_profile.mjs). */
  physicsPerf?: unknown;
  /** WaterForceSystem's per-frame readout (the debug overlay's flow arrows). */
  waterForce?: WaterForceTap;
  /** The raft's physics-worker water-force diagnostics (dev builds). */
  physicsWorker?: PhysicsWorkerTap;
  /** TrackManager's obstacle pool occupancy. */
  obstaclePool?: ObstaclePoolTap;
  /** The camera pose at the end of the last frame (NaN-guard diagnostics). */
  cameraDiag?: CameraDiagTap;
  /** `?debugGpuLoss`: force a context / device loss on the live renderer. */
  loseGpu?: () => string | null;
  /** WasmWaterForceTest's probe body. */
  wasmWaterTest?: unknown;
}

const taps: DebugTaps = {};

let enabled: boolean | null = null;
/** `?debug`, `?physicsDebug` or `?screenshot`: the readouts are worth building. */
export function debugTapsEnabled(): boolean {
  enabled ??= queryFlags().debugGlobals;
  return enabled;
}

export function setDebugTap<K extends keyof DebugTaps>(key: K, value: DebugTaps[K]): void {
  taps[key] = value;
}

export function getDebugTap<K extends keyof DebugTaps>(key: K): DebugTaps[K] {
  return taps[key];
}
