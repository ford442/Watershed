/**
 * WatershedWasm.ts — heap-backed helpers over the watershed_native module.
 *
 * The module itself is loaded by wasmLoader.ts (`getWasm()` on the main
 * thread, `getWorkerWasm()` in the sim worker) and bound by wasmAbi.ts. This
 * file owns the allocations game code holds on to: the SWE grid and the
 * water-force batch, both Float32Array views made once over the fixed-size heap.
 *
 *   const wasm = await getWasm();
 *   const grid = createSWEGrid(wasm, 32, 32, 0.5);
 *   wasm.stepShallowWater(grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr,
 *     grid.width, grid.height, delta, 9.8, grid.dx, 1.0);
 *   grid.dispose();
 */

import {
  allocateGrids,
  heapF32,
  WATER_FORCE_INPUT_STRIDE,
  WATER_FORCE_OUTPUT_STRIDE,
  type NativeWaterForceConfig,
  type NativeWaterForceResult,
  type NativeWaterForceSample,
  type WatershedNativeModule,
} from './wasmAbi';

// ---------------------------------------------------------------------------
// Shallow Water Equations (SWE) grid helper
// ---------------------------------------------------------------------------

/** A SWE simulation grid allocated in WASM linear memory. */
export interface SWEGrid {
  /** Grid width (columns). */
  width:  number;
  /** Grid height (rows). */
  height: number;
  /** Cell size (m). */
  dx:     number;
  /** WASM heap byte-offset for the height field. */
  hPtr:   number;
  /** WASM heap byte-offset for the X-velocity field. */
  uPtr:   number;
  /** WASM heap byte-offset for the Z-velocity field. */
  wPtr:   number;
  /** WASM heap byte-offset for the bed-elevation field. */
  bPtr:   number;
  /** Live Float32 view into the WASM heap — water height. */
  h:      Float32Array;
  /** Live Float32 view into the WASM heap — X velocity. */
  u:      Float32Array;
  /** Live Float32 view into the WASM heap — Z velocity. */
  w:      Float32Array;
  /**
   * Live Float32 view into the WASM heap — bed elevation above the channel
   * floor datum (m). 0 everywhere is a flat bed at full depth; values
   * approaching the still-water depth are banks that dry out.
   */
  b:      Float32Array;
  /** Free all WASM heap allocations.  Call when the grid is no longer needed. */
  dispose(): void;
}

export interface NativeWaterForceBatch {
  sampleCount: number;
  inputPtr: number;
  outputPtr: number;
  input: Float32Array;
  output: Float32Array;
  setSample(index: number, sample: NativeWaterForceSample): void;
  compute(config: NativeWaterForceConfig): Float32Array;
  readResult(index: number): NativeWaterForceResult;
  dispose(): void;
}

/**
 * Allocate a Shallow Water Equations grid in WASM linear memory.
 *
 * The returned Float32Array views (`h`, `u`, `w`) are live windows directly
 * into WASM memory — writes are immediately visible to `stepShallowWater`.
 *
 * @param mod     Loaded WatershedNativeModule (from getWasm())
 * @param width   Grid columns
 * @param height  Grid rows
 * @param dx      Cell size in metres (default 0.5)
 *
 * @example
 *   const wasm = await getWasm();
 *   const grid = createSWEGrid(wasm, 32, 32, 0.5);
 *
 *   // Set a Gaussian splash at the centre
 *   const cx = grid.width  / 2;
 *   const cz = grid.height / 2;
 *   for (let z = 0; z < grid.height; z++) {
 *     for (let x = 0; x < grid.width; x++) {
 *       const d = Math.hypot(x - cx, z - cz);
 *       grid.h[z * grid.width + x] = 1.0 + 0.4 * Math.exp(-d * d / 10);
 *     }
 *   }
 *
 *   // Per-frame in useFrame:
 *   wasm.stepShallowWater(grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr,
 *     grid.width, grid.height, delta, 9.8, grid.dx, 1.0);
 *
 *   // On unmount:
 *   grid.dispose();
 */
export function createSWEGrid(
  mod: WatershedNativeModule,
  width:  number,
  height: number,
  dx:     number = 0.5,
): SWEGrid {
  const count = width * height;

  const [hPtr, uPtr, wPtr, bPtr] = allocateGrids(mod, [count, count, count, count]);
  mod.reserveShallowWaterScratch(width, height);

  return {
    width, height, dx,
    hPtr, uPtr, wPtr, bPtr,
    // The heap is fixed-size, so these views stay valid until dispose().
    h: heapF32(mod, hPtr, count),
    u: heapF32(mod, uPtr, count),
    w: heapF32(mod, wPtr, count),
    b: heapF32(mod, bPtr, count),
    dispose() {
      mod.freeGrid(hPtr);
      mod.freeGrid(uPtr);
      mod.freeGrid(wPtr);
      mod.freeGrid(bPtr);
    },
  };
}

export function createWaterForceBatch(
  mod: WatershedNativeModule,
  sampleCount: number,
): NativeWaterForceBatch {
  const [inputPtr, outputPtr] = allocateGrids(mod, [
    sampleCount * WATER_FORCE_INPUT_STRIDE,
    sampleCount * WATER_FORCE_OUTPUT_STRIDE,
  ]);
  const inCount = sampleCount * WATER_FORCE_INPUT_STRIDE;
  const outCount = sampleCount * WATER_FORCE_OUTPUT_STRIDE;
  const input = heapF32(mod, inputPtr, inCount);
  const output = heapF32(mod, outputPtr, outCount);

  return {
    sampleCount,
    inputPtr,
    outputPtr,
    input,
    output,
    setSample(index, sample) {
      if (index < 0 || index >= sampleCount) {
        throw new RangeError(`Water force sample ${index} out of range`);
      }
      const offset = index * WATER_FORCE_INPUT_STRIDE;
      input[offset + 0] = sample.position.x;
      input[offset + 1] = sample.position.y;
      input[offset + 2] = sample.position.z;
      input[offset + 3] = sample.velocity.x;
      input[offset + 4] = sample.velocity.y;
      input[offset + 5] = sample.velocity.z;
      input[offset + 6] = sample.flowDirection.x;
      input[offset + 7] = sample.flowDirection.z;
    },
    compute(config) {
      mod.computeWaterForcesBatch(
        inputPtr,
        outputPtr,
        sampleCount,
        config.flowSpeed,
        config.waterLevel,
        config.raftMass,
        config.raftVolume,
        config.dragCoefficient,
        config.frontalArea,
        config.sideArea,
        config.timeSeconds,
        config.turbulenceStrength,
        config.turbulenceFrequency,
      );
      return output;
    },
    readResult(index) {
      if (index < 0 || index >= sampleCount) {
        throw new RangeError(`Water force result ${index} out of range`);
      }
      const offset = index * WATER_FORCE_OUTPUT_STRIDE;
      return {
        forceX: output[offset + 0],
        forceY: output[offset + 1],
        forceZ: output[offset + 2],
        buoyancy: output[offset + 3],
        drag: output[offset + 4],
        flow: output[offset + 5],
        turbulence: output[offset + 6],
        submergedRatio: output[offset + 7],
      };
    },
    dispose() {
      mod.freeGrid(inputPtr);
      mod.freeGrid(outputPtr);
    },
  };
}
