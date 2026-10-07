/**
 * hullLinkProtocol — the Rapier worker ↔ sim worker link (#455 Phase B).
 *
 * The main thread hands each worker one end of a MessageChannel; after that the
 * raft's water force never crosses the main thread. Tick order (Rapier tick N):
 *
 *   1. apply the latest HULL_FORCE (computed from the hull state posted after
 *      tick N−1, on the sim worker's field at the time it arrived)
 *   2. apply external impulses (paddle, …), world.step()
 *   3. post HULL with the post-step state — the state tick N+1 starts from
 *
 * So forces computed on sim tick N are applied on Rapier tick N+1. A result
 * older than HULL_FORCE_MAX_AGE ticks is not applied (the sim worker died or
 * stalled); the tick then uses the TS fallback on the authored flow.
 */

export type HullLinkToSim = {
  type: 'HULL';
  seq: number;
  /** One simForces.ts sample (FORCE_SAMPLE_STRIDE values). Transferred. */
  sample: Float64Array;
};

export type HullLinkToPhysics = {
  type: 'HULL_FORCE';
  seq: number;
  /** One simForces.ts result (FORCE_RESULT_STRIDE values), in the request's buffer. */
  result: Float64Array;
  computeMicros: number;
};

/** Rapier ticks a HULL_FORCE may trail the latest HULL by and still be applied. */
export const HULL_FORCE_MAX_AGE = 3;

/** The slice of MessagePort both ends use (a real port, or a test double). */
export interface HullLinkPort<In, Out> {
  postMessage(message: Out, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<In>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<In>) => void): void;
  start?(): void;
  close?(): void;
}
