import {
  createPhysicsWorkerWaterBatch,
  computePhysicsWorkerWaterForces,
  refreshPhysicsWorkerWaterBatch,
} from '../physicsWorkerWaterForces';
import {
  calculateWaterForceFallback,
  heapF32,
  WATER_FORCE_INPUT_STRIDE,
  WATER_FORCE_OUTPUT_STRIDE,
  type WatershedNativeModule,
} from '../../systems/water/WatershedWasm';
import type { WorkerRaftState } from '../rapierWorkerProtocol';

function mockMod(): WatershedNativeModule {
  const buffer = new ArrayBuffer(1024 * 1024);
  let nextPtr = 4;
  const allocations = new Map<number, number>();
  return {
    HEAPF32: new Float32Array(buffer),
    HEAP32: new Int32Array(buffer),
    HEAPU8: new Uint8Array(buffer),
    getVersion: () => 8,
    allocateGrid(count: number) {
      const ptr = nextPtr;
      nextPtr += count * 4;
      allocations.set(ptr, count);
      return ptr;
    },
    freeGrid(ptr: number) {
      allocations.delete(ptr);
    },
    computeWaterForcesBatch() {
      /* tests use the TS fallback path or inspect the packed input */
    },
  } as unknown as WatershedNativeModule;
}

const SAMPLE_STATE: WorkerRaftState = {
  position: [0, 0.45, -10],
  rotation: [0, 0, 0, 1],
  velocity: [0.2, 0, -1.4],
  angularVelocity: [0, 0, 0],
};

describe('physicsWorkerWaterBatch heap growth', () => {
  it('createPhysicsWorkerWaterBatch views rebind after HEAPF32 swap', () => {
    const mod = mockMod();
    const batch = createPhysicsWorkerWaterBatch(mod);
    const staleInput = batch.input;
    staleInput[0] = 7;
    const grown = new ArrayBuffer(mod.HEAPF32.buffer.byteLength + 4096);
    new Uint8Array(grown).set(new Uint8Array(mod.HEAPF32.buffer));
    mod.HEAPF32 = new Float32Array(grown);
    mod.HEAP32 = new Int32Array(grown);
    mod.HEAPU8 = new Uint8Array(grown);
    expect(staleInput.buffer === mod.HEAPF32.buffer).toBe(false);
    refreshPhysicsWorkerWaterBatch(mod, batch);
    batch.input[1] = 4.5;
    const live = new Float32Array(mod.HEAPF32.buffer, batch.inputPtr, WATER_FORCE_INPUT_STRIDE);
    expect(live[1]).toBe(4.5);
    expect(batch.input.byteLength).toBe(WATER_FORCE_INPUT_STRIDE * 4);
    expect(batch.output.byteLength).toBe(WATER_FORCE_OUTPUT_STRIDE * 4);
  });

  it('computePhysicsWorkerWaterForces packs into the live heap after growth', () => {
    const mod = mockMod();
    const batch = createPhysicsWorkerWaterBatch(mod);
    const grown = new ArrayBuffer(mod.HEAPF32.buffer.byteLength + 8192);
    new Uint8Array(grown).set(new Uint8Array(mod.HEAPF32.buffer));
    mod.HEAPF32 = new Float32Array(grown);
    computePhysicsWorkerWaterForces(mod, batch, SAMPLE_STATE, {
      enabled: true,
      flowSpeed: 4.5,
      waterLevel: 0.5,
      raftMass: 150,
      raftVolume: 1.2,
      dragCoefficient: 0.47,
      frontalArea: 1.05,
      sideArea: 0.7,
      timeSeconds: 12.5,
      turbulenceStrength: 0.08,
      turbulenceFrequency: 2.4,
      flowDirX: 0,
      flowDirZ: -1,
    });
    const live = new Float32Array(mod.HEAPF32.buffer, batch.inputPtr, 8);
    expect(live[1]).toBeCloseTo(0.45, 5);
    expect(live[2]).toBe(-10);
    expect(live[7]).toBe(-1);
    expect(typeof calculateWaterForceFallback).toBe('function');
    expect(heapF32(mod, batch.inputPtr, 8, batch.input)).toBe(batch.input);
  });
});
