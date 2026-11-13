/**
 * traceBuffer — the preallocated ring a recording writes into (#559 D).
 *
 * One Float64Array of `capacity` × 3: (kind << 20 | name id, start ms, duration
 * ms or counter value). Allocated once when the recording starts; a span is
 * three stores, so a recording allocates nothing per frame either. When the
 * ring is full the oldest events are overwritten: a recording keeps the last
 * `capacity` events, and `dropped` says how many fell off the front.
 *
 * Each thread has its own ring. A worker sends a snapshot (`TraceRingSnapshot`)
 * back over its trace port when the main thread asks (`traceWorkerSide.ts`).
 */
import type { TraceSink } from './traceProbe';

export const TRACE_KIND_SPAN = 0;
export const TRACE_KIND_INSTANT = 1;
export const TRACE_KIND_COUNTER = 2;

/** 128 Ki events (3 MB): 10 s at 60 fps is ~200 spans a frame per thread, and a 30 s scripted run fits whole. */
export const DEFAULT_TRACE_CAPACITY = 1 << 17;

const STRIDE = 3;
const KIND_SHIFT = 1 << 20;

/** A ring's events in recording order plus the name table its ids index. */
export interface TraceRingSnapshot {
  readonly names: readonly string[];
  readonly tracks: readonly string[];
  /** `count` × 3 values, oldest first: (kind << 20 | id, start, duration-or-value). */
  readonly events: Float64Array;
  readonly count: number;
  readonly dropped: number;
}

export interface TraceRing extends TraceSink {
  readonly capacity: number;
  /** Events written so far, including overwritten ones. */
  readonly written: number;
  /** A copy of the live events, oldest first. */
  snapshot(names: readonly string[], tracks: readonly string[]): TraceRingSnapshot;
}

export function createTraceRing(capacity = DEFAULT_TRACE_CAPACITY): TraceRing {
  const data = new Float64Array(capacity * STRIDE);
  let written = 0;

  const push = (kind: number, id: number, at: number, value: number): void => {
    const o = (written % capacity) * STRIDE;
    data[o] = kind * KIND_SHIFT + id;
    data[o + 1] = at;
    data[o + 2] = value;
    written += 1;
  };

  return {
    capacity,
    get written() {
      return written;
    },
    span(id, start, end) {
      push(TRACE_KIND_SPAN, id, start, end - start);
    },
    instant(id, at) {
      push(TRACE_KIND_INSTANT, id, at, 0);
    },
    counter(id, at, value) {
      push(TRACE_KIND_COUNTER, id, at, value);
    },
    snapshot(names, tracks) {
      const count = Math.min(written, capacity);
      const events = new Float64Array(count * STRIDE);
      const first = written > capacity ? written % capacity : 0;
      for (let i = 0; i < count; i += 1) {
        const from = ((first + i) % capacity) * STRIDE;
        events[i * STRIDE] = data[from]!;
        events[i * STRIDE + 1] = data[from + 1]!;
        events[i * STRIDE + 2] = data[from + 2]!;
      }
      return { names: [...names], tracks: [...tracks], events, count, dropped: written - count };
    },
  };
}

/** Decode one packed event. */
export function readTraceEvent(
  events: Float64Array,
  i: number,
): { kind: number; id: number; at: number; value: number } {
  const meta = events[i * STRIDE]!;
  const kind = Math.floor(meta / KIND_SHIFT);
  return { kind, id: meta - kind * KIND_SHIFT, at: events[i * STRIDE + 1]!, value: events[i * STRIDE + 2]! };
}
