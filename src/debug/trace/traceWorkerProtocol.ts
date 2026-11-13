/**
 * traceWorkerProtocol — messages on a worker's trace port (#559 D).
 *
 *   main → worker  SYNC   { seq, sentAt }       worker answers at once with its clock
 *                  START  { capacity }          install a ring; probes start writing
 *                  FLUSH                        send the ring back and stop recording
 *   worker → main  SYNC   { seq, sentAt, workerAt }
 *                  FLUSH  { snapshot }          `snapshot.events` is transferred
 *
 * Clock alignment is a ping-pong: for the round trip with the smallest RTT,
 * the worker read its clock at about the main thread's (sentAt + receivedAt)/2,
 * so offset = workerAt − that midpoint, with an error of at most RTT / 2.
 * Both clocks count from their thread's `performance.timeOrigin`, so the
 * origins' difference is the same offset measured another way; the export
 * records both, and perf_trace_smoke.mjs gates on their agreement.
 */
import type { TraceRingSnapshot } from './traceBuffer';

export type TraceWorkerCommand =
  | { type: 'SYNC'; seq: number; sentAt: number }
  | { type: 'START'; capacity: number }
  | { type: 'FLUSH' };

export type TraceWorkerReply =
  /** `origin` is the worker's `performance.timeOrigin`: an independent check of the offset. */
  | { type: 'SYNC'; seq: number; sentAt: number; workerAt: number; origin: number }
  | { type: 'FLUSH'; snapshot: TraceRingSnapshot };
