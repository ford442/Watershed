/**
 * simForces — the sim worker's force batch, without a binary (#455 Phase B).
 *
 * The stub's `computeWaterForcesBatch` is the TS twin of forces.cpp reading and
 * writing the stub heap, so these pin the wiring: which config reaches which
 * sample, runs of equal configs share one Embind call, and the heap views
 * survive memory growth (the old physicsWorkerWaterForces.heap test, moved with
 * the batch). Bit parity against the real binary: simWorker.integration.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  WATER_FORCE_INPUT_STRIDE,
  WATER_FORCE_OUTPUT_STRIDE,
  calculateWaterForceFallback,
  type NativeWaterForceConfig,
  type WatershedNativeModule,
} from '../systems/water/WatershedWasm';
import { sampleSWEFlow, SWE_STAGE_SPEED_BOOST, stagedWaterLevel, type SWEFlowGrid } from '../systems/water/sampleSWEFlow';
import {
  FORCE_RESULT_STRIDE,
  FORCE_SAMPLE_STRIDE,
  computeSimForces,
  createSimForceBatch,
  readForceFlow,
  readForceResult,
  writeForceSample,
} from './simForces';

function stubModule(opts: { growOnAllocate?: boolean } = {}) {
  let buffer = new ArrayBuffer(1 << 16);
  let next = 64;
  const mod = {
    HEAPF32: new Float32Array(buffer),
    getVersion: () => 11,
    allocateGrid: vi.fn((count: number) => {
      const ptr = next;
      next += count * 4;
      if (opts.growOnAllocate) {
        // Emscripten growth: a new, larger buffer; old views detach.
        const grown = new ArrayBuffer(buffer.byteLength + 4096);
        new Uint8Array(grown).set(new Uint8Array(buffer));
        buffer = grown;
        mod.HEAPF32 = new Float32Array(grown);
      }
      return ptr;
    }),
    freeGrid: vi.fn(),
    computeWaterForcesBatch: vi.fn(
      (inPtr: number, outPtr: number, n: number, ...c: number[]) => {
        const heap = mod.HEAPF32;
        const config: NativeWaterForceConfig = {
          flowSpeed: c[0], waterLevel: c[1], raftMass: c[2], raftVolume: c[3], dragCoefficient: c[4],
          frontalArea: c[5], sideArea: c[6], timeSeconds: c[7], turbulenceStrength: c[8], turbulenceFrequency: c[9],
        };
        for (let i = 0; i < n; i += 1) {
          const s = (inPtr >> 2) + i * WATER_FORCE_INPUT_STRIDE;
          const r = calculateWaterForceFallback(
            {
              position: { x: heap[s], y: heap[s + 1], z: heap[s + 2] },
              velocity: { x: heap[s + 3], y: heap[s + 4], z: heap[s + 5] },
              flowDirection: { x: heap[s + 6], z: heap[s + 7] },
            },
            config,
          );
          const o = (outPtr >> 2) + i * WATER_FORCE_OUTPUT_STRIDE;
          heap.set([r.forceX, r.forceY, r.forceZ, r.buoyancy, r.drag, r.flow, r.turbulence, r.submergedRatio], o);
        }
      },
    ),
  };
  return mod as typeof mod & WatershedNativeModule;
}

function config(overrides: Partial<NativeWaterForceConfig> = {}): NativeWaterForceConfig {
  return {
    flowSpeed: 0, // ignored on the wire: the worker derives it
    waterLevel: 0.5,
    raftMass: 150,
    raftVolume: 1.2,
    dragCoefficient: 0.47,
    frontalArea: 1.05,
    sideArea: 0.7,
    timeSeconds: 3.25,
    turbulenceStrength: 0.08,
    turbulenceFrequency: 2.4,
    ...overrides,
  };
}

/** A 6×4 grid with a steady +X current and a raised stage. */
function grid(): SWEFlowGrid {
  const n = 24;
  return {
    h: new Float32Array(n).fill(0.2),
    u: new Float32Array(n).fill(0.9),
    w: new Float32Array(n).fill(-0.3),
    b: new Float32Array(n),
    width: 6,
    height: 4,
    cellSize: 0.5,
    originX: -1,
    originZ: -1,
  };
}

const BODIES = [
  { position: { x: 0.1, y: 0.45, z: -0.2 }, velocity: { x: 0.2, y: 0, z: -1.4 } },
  { position: { x: 0.6, y: 0.3, z: 0.1 }, velocity: { x: 0, y: -0.1, z: 0 } },
  { position: { x: 0.6, y: 0.3, z: 0.1 }, velocity: { x: 0, y: -0.1, z: 0 } },
];

describe('computeSimForces', () => {
  it('matches the main-thread loop: sampled speed × scale, staged level, same config', () => {
    const wasm = stubModule();
    const batch = createSimForceBatch(wasm);
    const g = grid();
    const samples = new Float64Array(BODIES.length * FORCE_SAMPLE_STRIDE);
    BODIES.forEach((body, i) => writeForceSample(samples, i, body, config(), 2.5, i === 0 ? 1 : 0.6));
    const out = new Float64Array(BODIES.length * FORCE_RESULT_STRIDE);
    computeSimForces(wasm, batch, g, samples, BODIES.length, out);

    BODIES.forEach((body, i) => {
      const flow = sampleSWEFlow({
        worldX: body.position.x,
        worldZ: body.position.z,
        flowSpeed: 2.5,
        grid: g,
        enabled: true,
        stageSpeedBoost: SWE_STAGE_SPEED_BOOST,
      });
      const f32 = (v: number) => Math.fround(v);
      const expected = calculateWaterForceFallback(
        {
          position: { x: f32(body.position.x), y: f32(body.position.y), z: f32(body.position.z) },
          velocity: { x: f32(body.velocity.x), y: f32(body.velocity.y), z: f32(body.velocity.z) },
          flowDirection: { x: f32(flow.dirX), z: f32(flow.dirZ) },
        },
        config({ flowSpeed: flow.speed * (i === 0 ? 1 : 0.6), waterLevel: stagedWaterLevel(0.5, flow) }),
      );
      const got = readForceResult(out, i);
      for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
        expect(got[key], `${i}.${key}`).toBe(Math.fround(expected[key]));
      }
      expect(readForceFlow(out, i)).toEqual(flow);
    });
  });

  it('takes one Embind call per run of float32-equal configs', () => {
    const wasm = stubModule();
    const batch = createSimForceBatch(wasm);
    const samples = new Float64Array(BODIES.length * FORCE_SAMPLE_STRIDE);
    // Bodies 1 and 2 are identical debris; body 0 is the hull.
    BODIES.forEach((body, i) => writeForceSample(samples, i, body, config({ raftMass: i === 0 ? 150 : 2 }), 2.5, 1));
    const out = new Float64Array(BODIES.length * FORCE_RESULT_STRIDE);

    // No grid: every sample gets the authored flow, so only mass splits the runs.
    const stats = computeSimForces(wasm, batch, null, samples, BODIES.length, out);
    expect(stats.calls).toBe(2);
    expect(wasm.computeWaterForcesBatch).toHaveBeenCalledTimes(2);
    expect(wasm.computeWaterForcesBatch.mock.calls[1][2]).toBe(2);
    expect(readForceFlow(out, 2).source).toBe('fallback');
  });

  it('packs into the live heap after memory growth (views rebind)', () => {
    const wasm = stubModule({ growOnAllocate: true });
    const batch = createSimForceBatch(wasm);
    const n = 5;
    const samples = new Float64Array(n * FORCE_SAMPLE_STRIDE);
    for (let i = 0; i < n; i += 1) writeForceSample(samples, i, BODIES[i % BODIES.length], config(), 2.5, 1);
    const out = new Float64Array(n * FORCE_RESULT_STRIDE);
    // Capacity 4 → 5 reallocates, which grows (detaches) the heap mid-call.
    computeSimForces(wasm, batch, null, samples, n, out);
    expect(batch.capacity).toBeGreaterThanOrEqual(n);
    const live = new Float32Array(wasm.HEAPF32.buffer, batch.inputPtr, n * WATER_FORCE_INPUT_STRIDE);
    expect(live[4 * WATER_FORCE_INPUT_STRIDE + 0]).toBe(Math.fround(0.6));
    expect(live[4 * WATER_FORCE_INPUT_STRIDE + 7]).toBe(-1);
    expect(readForceResult(out, 4).submergedRatio).toBeGreaterThan(0);
    batch.dispose();
    expect(wasm.freeGrid).toHaveBeenCalledTimes(4); // two reallocations' worth
  });
});
