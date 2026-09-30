/**
 * simForceRequests — main-thread bookkeeping for water forces computed in the
 * sim worker (#455 Phase B).
 *
 * WaterForceSystem packs its bodies (simForces.ts wire format) after the frame's
 * STEP and posts them; the worker samples the stepped field, runs the batch and
 * sends the buffer back holding the results. They land between frames and are
 * applied at the top of the next frame, with the dt of the frame that sampled
 * them, to the bodies that are still registered — so debris forces trail the
 * field by one frame, as the Rapier worker's hull force does (hullLinkProtocol.ts).
 *
 * Buffers cycle: a landed result's buffer is reused for a later request, so the
 * steady state allocates nothing.
 */
import { FORCE_SAMPLE_STRIDE } from './simForces';
import type { SimWorkerProxy } from './createSimWorkerProxy';
import type { SimForceResult } from './simWorkerProtocol';

/** Requests allowed in flight; beyond this the worker is behind and a frame skips its forces. */
const MAX_IN_FLIGHT = 4;

export interface LandedForces<T> {
  targets: readonly T[];
  /** Render delta of the frame that sampled them (s). */
  dt: number;
  count: number;
  results: Float64Array;
  calls: number;
  computeMicros: number;
}

export interface SimForceRequests<T> {
  /** A buffer with room for `count` samples, from the pool when one fits. */
  acquire(count: number): Float64Array;
  /** Post `count` samples for `targets` (same order). False when not sent (dead worker, backlog). */
  send(
    gridId: number,
    originX: number,
    originZ: number,
    samples: Float64Array,
    targets: readonly T[],
    dt: number,
  ): boolean;
  /** Results that landed since the last call, oldest first. */
  drain(): LandedForces<T>[];
  /** Return a drained result's buffer to the pool. */
  release(results: Float64Array): void;
  readonly inFlight: number;
  dispose(): void;
}

export function createSimForceRequests<T>(proxy: SimWorkerProxy): SimForceRequests<T> {
  const pending = new Map<number, { targets: readonly T[]; dt: number }>();
  let landed: LandedForces<T>[] = [];
  const pool: Float64Array[] = [];

  const unsubscribe = proxy.onForces((result: SimForceResult) => {
    const request = pending.get(result.seq);
    if (!request) return;
    pending.delete(result.seq);
    landed.push({ ...request, ...result });
  });

  return {
    acquire(count) {
      const need = count * FORCE_SAMPLE_STRIDE;
      for (let i = 0; i < pool.length; i += 1) {
        if (pool[i].length >= need) return pool.splice(i, 1)[0];
      }
      return new Float64Array(Math.max(need, 4 * FORCE_SAMPLE_STRIDE));
    },
    send(gridId, originX, originZ, samples, targets, dt) {
      if (proxy.failed || pending.size >= MAX_IN_FLIGHT) {
        pool.push(samples);
        return false;
      }
      const seq = proxy.requestForces(gridId, originX, originZ, samples, targets.length);
      if (seq === null) return false;
      pending.set(seq, { targets, dt });
      return true;
    },
    drain() {
      if (landed.length === 0) return landed;
      const out = landed;
      landed = [];
      return out;
    },
    release(results) {
      if (pool.length < 2) pool.push(results);
    },
    get inFlight() {
      return pending.size;
    },
    dispose() {
      unsubscribe();
      pending.clear();
      landed = [];
      pool.length = 0;
    },
  };
}
