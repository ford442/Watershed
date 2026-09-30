/**
 * simForces — water forces computed in the sim worker (#455 Phase B).
 *
 * The hull and debris forces read (η, u, w, b) from the field that is actually
 * being stepped, not from a main-thread mirror one message old. Callers send
 * force samples (world-space body state + the flow-independent part of the
 * force config); the worker samples the flow at each body on its live grid
 * (`sampleSWEFlow`, same function, same numbers as the main-thread path), stages
 * the water level (`stagedWaterLevel`), and runs `computeWaterForcesBatch`.
 *
 * Wire format — Float64, so a position reaches `sampleSWEFlow` with the bits the
 * caller had (the native input is float32; rounding happens only where the
 * main-thread `calculateWaterForce` rounds too, at the WASM boundary):
 *
 *   sample (FORCE_SAMPLE_STRIDE): px py pz | vx vy vz | flowSpeed flowScale
 *     waterLevel | raftMass raftVolume dragCoefficient frontalArea sideArea |
 *     timeSeconds turbulenceStrength turbulenceFrequency
 *   `flowSpeed` / `waterLevel` are the AUTHORED values (the SWE speed cap and the
 *   still level); the native call gets `flow.speed * flowScale` and the staged level.
 *
 *   result (FORCE_RESULT_STRIDE): the WATER_FORCE_OUTPUT_STRIDE native output
 *     (forceX forceY forceZ buoyancy drag flow turbulence submergedRatio), then
 *     the flow sample it used: dirX dirZ speed surfaceOffset depth flags.
 *
 * `computeWaterForcesBatch` takes ONE config per call, but every body has its
 * own SWE-sampled speed and stage, so the worker batches runs of consecutive
 * samples whose configs are equal at float32 (what the ABI sees). Each run is
 * one Embind call; the per-sample math is `calculateWaterForce` either way
 * (forces.cpp), so the result is bit-identical to one `calculateWaterForce` per
 * body on the main thread. Folding speed/stage into one call for all bodies
 * would need a per-sample-config export (an ABI bump) — out of scope here.
 *
 * This module is imported by the Rapier worker and the main thread for the wire
 * helpers only; the batch half needs a module and runs only in the sim worker.
 */
import {
  WATER_FORCE_INPUT_STRIDE,
  WATER_FORCE_OUTPUT_STRIDE,
  heapF32,
  type NativeWaterForceConfig,
  type NativeWaterForceResult,
  type WatershedNativeModule,
} from '../systems/water/WatershedWasm';
import {
  SWE_STAGE_SPEED_BOOST,
  sampleSWEFlow,
  stagedWaterLevel,
  type SWEFlowGrid,
  type SWEFlowSample,
} from '../systems/water/sampleSWEFlow';

export const FORCE_SAMPLE_STRIDE = 17;
export const FORCE_RESULT_STRIDE = WATER_FORCE_OUTPUT_STRIDE + 6;

/** Result flag bits (slot WATER_FORCE_OUTPUT_STRIDE + 5). */
export const FORCE_FLAG_WET = 1;
export const FORCE_FLAG_SWE = 2;

/** Config values the native call takes, in call order. */
const CONFIG_WIDTH = 10;

export interface ForceSampleBody {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

/**
 * Write sample `index`. `config.flowSpeed` is ignored — the worker derives it
 * from the sampled flow — pass the authored cap as `flowSpeed` and the factor
 * the body scales the sampled speed by as `flowScale` (1 for a hull,
 * FLOATING_OBJECT.FLOW_INFLUENCE for debris). `config.waterLevel` is the
 * authored level; the worker stages it.
 */
export function writeForceSample(
  out: Float64Array,
  index: number,
  body: ForceSampleBody,
  config: NativeWaterForceConfig,
  flowSpeed: number,
  flowScale: number,
): void {
  const o = index * FORCE_SAMPLE_STRIDE;
  out[o + 0] = body.position.x;
  out[o + 1] = body.position.y;
  out[o + 2] = body.position.z;
  out[o + 3] = body.velocity.x;
  out[o + 4] = body.velocity.y;
  out[o + 5] = body.velocity.z;
  out[o + 6] = flowSpeed;
  out[o + 7] = flowScale;
  out[o + 8] = config.waterLevel;
  out[o + 9] = config.raftMass;
  out[o + 10] = config.raftVolume;
  out[o + 11] = config.dragCoefficient;
  out[o + 12] = config.frontalArea;
  out[o + 13] = config.sideArea;
  out[o + 14] = config.timeSeconds;
  out[o + 15] = config.turbulenceStrength;
  out[o + 16] = config.turbulenceFrequency;
}

export function readForceResult(results: Float64Array, index: number): NativeWaterForceResult {
  const o = index * FORCE_RESULT_STRIDE;
  return {
    forceX: results[o + 0],
    forceY: results[o + 1],
    forceZ: results[o + 2],
    buoyancy: results[o + 3],
    drag: results[o + 4],
    flow: results[o + 5],
    turbulence: results[o + 6],
    submergedRatio: results[o + 7],
  };
}

/** The flow sample the worker used for result `index`. */
export function readForceFlow(results: Float64Array, index: number): SWEFlowSample {
  const o = index * FORCE_RESULT_STRIDE + WATER_FORCE_OUTPUT_STRIDE;
  const flags = results[o + 5];
  return {
    dirX: results[o + 0],
    dirZ: results[o + 1],
    speed: results[o + 2],
    surfaceOffset: results[o + 3],
    depth: results[o + 4],
    wet: (flags & FORCE_FLAG_WET) !== 0,
    source: (flags & FORCE_FLAG_SWE) !== 0 ? 'swe' : 'fallback',
  };
}

// ---------------------------------------------------------------------------
// Worker half
// ---------------------------------------------------------------------------

/** Heap input/output for up to `capacity` samples; grows, never shrinks. */
export interface SimForceBatch {
  readonly capacity: number;
  readonly inputPtr: number;
  readonly outputPtr: number;
  dispose(): void;
}

interface MutableSimForceBatch extends SimForceBatch {
  capacity: number;
  inputPtr: number;
  outputPtr: number;
  input: Float32Array;
  output: Float32Array;
  configs: Float64Array;
  disposed: boolean;
}

export function createSimForceBatch(wasm: WatershedNativeModule, capacity = 4): SimForceBatch {
  const batch: MutableSimForceBatch = {
    capacity: 0,
    inputPtr: 0,
    outputPtr: 0,
    input: new Float32Array(0),
    output: new Float32Array(0),
    configs: new Float64Array(0),
    disposed: false,
    dispose() {
      if (batch.disposed) return;
      batch.disposed = true;
      if (batch.inputPtr) wasm.freeGrid(batch.inputPtr);
      if (batch.outputPtr) wasm.freeGrid(batch.outputPtr);
      batch.inputPtr = 0;
      batch.outputPtr = 0;
    },
  };
  reserve(wasm, batch, capacity);
  return batch;
}

function reserve(wasm: WatershedNativeModule, batch: MutableSimForceBatch, count: number): void {
  if (count <= batch.capacity) return;
  const capacity = Math.max(count, batch.capacity * 2, 4);
  if (batch.inputPtr) wasm.freeGrid(batch.inputPtr);
  if (batch.outputPtr) wasm.freeGrid(batch.outputPtr);
  batch.inputPtr = wasm.allocateGrid(capacity * WATER_FORCE_INPUT_STRIDE);
  batch.outputPtr = wasm.allocateGrid(capacity * WATER_FORCE_OUTPUT_STRIDE);
  batch.capacity = capacity;
  batch.configs = new Float64Array(capacity * CONFIG_WIDTH);
  // Views bind below, after any growth these allocations caused.
  batch.input = new Float32Array(0);
  batch.output = new Float32Array(0);
}

/** Rebind the heap views: Emscripten memory growth detaches the old ones. */
function bindViews(wasm: WatershedNativeModule, batch: MutableSimForceBatch): void {
  batch.input = heapF32(wasm, batch.inputPtr, batch.capacity * WATER_FORCE_INPUT_STRIDE, batch.input);
  batch.output = heapF32(wasm, batch.outputPtr, batch.capacity * WATER_FORCE_OUTPUT_STRIDE, batch.output);
}

function sameAtFloat32(configs: Float64Array, a: number, b: number): boolean {
  for (let k = 0; k < CONFIG_WIDTH; k += 1) {
    if (!Object.is(Math.fround(configs[a + k]), Math.fround(configs[b + k]))) return false;
  }
  return true;
}

export interface SimForceStats {
  /** Embind calls this batch took (one per run of equal configs). */
  calls: number;
  /** Wall time of sampling + native calls, microseconds. */
  computeMicros: number;
}

/**
 * Forces for `count` samples on `grid` (null: SWE off here — the authored
 * fallback flow, exactly as the main thread samples without a grid). Writes
 * `count * FORCE_RESULT_STRIDE` values into `out`.
 */
export function computeSimForces(
  wasm: WatershedNativeModule,
  handle: SimForceBatch,
  grid: SWEFlowGrid | null,
  samples: Float64Array,
  count: number,
  out: Float64Array,
  now: () => number = () => performance.now(),
): SimForceStats {
  const batch = handle as MutableSimForceBatch;
  if (batch.disposed || count <= 0) return { calls: 0, computeMicros: 0 };
  const t0 = now();
  reserve(wasm, batch, count);
  bindViews(wasm, batch);
  const { input, configs } = batch;

  for (let i = 0; i < count; i += 1) {
    const s = i * FORCE_SAMPLE_STRIDE;
    const flow = sampleSWEFlow({
      worldX: samples[s + 0],
      worldZ: samples[s + 2],
      flowSpeed: samples[s + 6],
      grid,
      enabled: grid !== null,
      stageSpeedBoost: SWE_STAGE_SPEED_BOOST,
    });
    const inBase = i * WATER_FORCE_INPUT_STRIDE;
    input[inBase + 0] = samples[s + 0];
    input[inBase + 1] = samples[s + 1];
    input[inBase + 2] = samples[s + 2];
    input[inBase + 3] = samples[s + 3];
    input[inBase + 4] = samples[s + 4];
    input[inBase + 5] = samples[s + 5];
    input[inBase + 6] = flow.dirX;
    input[inBase + 7] = flow.dirZ;

    const c = i * CONFIG_WIDTH;
    configs[c + 0] = flow.speed * samples[s + 7];
    configs[c + 1] = stagedWaterLevel(samples[s + 8], flow);
    for (let k = 2; k < CONFIG_WIDTH; k += 1) configs[c + k] = samples[s + 7 + k];

    const r = i * FORCE_RESULT_STRIDE + WATER_FORCE_OUTPUT_STRIDE;
    out[r + 0] = flow.dirX;
    out[r + 1] = flow.dirZ;
    out[r + 2] = flow.speed;
    out[r + 3] = flow.surfaceOffset;
    out[r + 4] = flow.depth;
    out[r + 5] = (flow.wet ? FORCE_FLAG_WET : 0) | (flow.source === 'swe' ? FORCE_FLAG_SWE : 0);
  }

  let calls = 0;
  let start = 0;
  for (let i = 1; i <= count; i += 1) {
    if (i < count && sameAtFloat32(configs, start * CONFIG_WIDTH, i * CONFIG_WIDTH)) continue;
    const c = start * CONFIG_WIDTH;
    wasm.computeWaterForcesBatch(
      batch.inputPtr + start * WATER_FORCE_INPUT_STRIDE * 4,
      batch.outputPtr + start * WATER_FORCE_OUTPUT_STRIDE * 4,
      i - start,
      configs[c + 0],
      configs[c + 1],
      configs[c + 2],
      configs[c + 3],
      configs[c + 4],
      configs[c + 5],
      configs[c + 6],
      configs[c + 7],
      configs[c + 8],
      configs[c + 9],
    );
    calls += 1;
    start = i;
  }

  // The call cannot grow the heap, but rebind anyway: reads must never go
  // through a detached view (they return 0s without throwing).
  bindViews(wasm, batch);
  const { output } = batch;
  for (let i = 0; i < count; i += 1) {
    const o = i * WATER_FORCE_OUTPUT_STRIDE;
    const r = i * FORCE_RESULT_STRIDE;
    for (let k = 0; k < WATER_FORCE_OUTPUT_STRIDE; k += 1) out[r + k] = output[o + k];
  }
  return { calls, computeMicros: Math.round((now() - t0) * 1000) };
}
