/**
 * simParticles — one particle SoA in the sim worker, seen from the main
 * thread. Same shape as simForceRequests.ts: never blocks, a step posted on
 * frame N is drained on frame N+1, and at most one step is in flight per
 * pool (a backlogged worker skips native steps instead of queueing them).
 *
 * Buffers ride the transfer list both ways and are reused, so a steady frame
 * allocates nothing.
 */
import type { SimWorkerProxy } from './createSimWorkerProxy';
import {
  SPLASH_WIRE_PLANES,
  WATERFALL_WIRE_PLANES,
  type SimParticleResult,
} from './simWorkerProtocol';

const SPARE_LIMIT = 2;

export interface SimParticleChannel {
  readonly poolId: number;
  /** False once the worker has died; the caller integrates in JS from then on. */
  readonly alive: boolean;
  /** A step was posted and has not landed yet. */
  readonly busy: boolean;
  initWaterfall(
    active: number,
    width: number,
    height: number,
    depthZ: number,
    fanSpreadRad: number,
    seed: number,
  ): void;
  /** Posts a waterfall step; false (nothing posted) when dead or busy. */
  stepWaterfall(active: number, dt: number, width: number, height: number, depthZ: number): boolean;
  /**
   * A buffer for `count` splash particles' wire planes
   * (px | py | pz | vx | vy | vz | life | maxLife). Fill it, then `stepSplash`.
   */
  splashBuffer(count: number): Float32Array;
  /** Posts `planes` (from `splashBuffer`) for a splash step; false when dead or busy. */
  stepSplash(planes: Float32Array, count: number, dt: number, gravityY: number, damp: number): boolean;
  /** The landed step, once. Hand its buffer back with `recycle` when done reading it. */
  drain(): SimParticleResult | null;
  recycle(buffer: ArrayBuffer): void;
  dispose(): void;
}

export function createSimParticleChannel(proxy: SimWorkerProxy, capacity: number): SimParticleChannel {
  const poolId = proxy.allocatePoolId();
  const spare: ArrayBuffer[] = [];
  let nextSeq = 1;
  let inFlight: number | null = null;
  let landed: SimParticleResult | null = null;
  let disposed = false;

  const unsubscribe = proxy.onParticles(poolId, (result) => {
    if (result.seq !== inFlight) return;
    inFlight = null;
    landed = result;
  });
  proxy.post({ type: 'PARTICLES_ALLOC', poolId, capacity });

  const bufferFor = (bytes: number): ArrayBuffer => {
    for (let i = spare.length - 1; i >= 0; i -= 1) {
      if (spare[i].byteLength >= bytes) return spare.splice(i, 1)[0];
    }
    return new ArrayBuffer(bytes);
  };

  const recycle = (buffer: ArrayBuffer) => {
    if (spare.length < SPARE_LIMIT) spare.push(buffer);
  };

  const ready = () => !disposed && !proxy.failed && inFlight === null;

  return {
    poolId,
    get alive() {
      return !disposed && !proxy.failed;
    },
    get busy() {
      return inFlight !== null;
    },
    initWaterfall(active, width, height, depthZ, fanSpreadRad, seed) {
      proxy.post({ type: 'PARTICLES_INIT_WATERFALL', poolId, active, width, height, depthZ, fanSpreadRad, seed });
    },
    stepWaterfall(active, dt, width, height, depthZ) {
      if (!ready()) return false;
      const n = Math.max(0, Math.min(active, capacity));
      const out = bufferFor(n * WATERFALL_WIRE_PLANES * 4);
      const seq = nextSeq++;
      inFlight = seq;
      proxy.post(
        { type: 'PARTICLES_STEP_WATERFALL', poolId, seq, active: n, dt, width, height, depthZ, out },
        [out],
      );
      return true;
    },
    splashBuffer(count) {
      const n = Math.max(0, Math.min(count, capacity));
      return new Float32Array(bufferFor(n * SPLASH_WIRE_PLANES * 4), 0, n * SPLASH_WIRE_PLANES);
    },
    stepSplash(planes, count, dt, gravityY, damp) {
      if (!ready()) {
        recycle(planes.buffer as ArrayBuffer);
        return false;
      }
      const seq = nextSeq++;
      inFlight = seq;
      const buffer = planes.buffer as ArrayBuffer;
      proxy.post(
        { type: 'PARTICLES_STEP_SPLASH', poolId, seq, count, dt, gravityY, damp, planes: buffer },
        [buffer],
      );
      return true;
    },
    drain() {
      const result = landed;
      landed = null;
      return result;
    },
    recycle,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      proxy.post({ type: 'PARTICLES_FREE', poolId });
      spare.length = 0;
      landed = null;
      inFlight = null;
    },
  };
}
