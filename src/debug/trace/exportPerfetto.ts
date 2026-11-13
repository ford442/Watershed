/**
 * exportPerfetto — one timeline from every thread's ring (#559 D).
 *
 * Writes the Chrome Trace Event JSON object format, which ui.perfetto.dev (and
 * chrome://tracing) open directly: `ph: 'X'` spans, `ph: 'i'` instants,
 * `ph: 'C'` counters, `ph: 'M'` names for the process and its tracks. One
 * process ("Watershed"); every (thread, track) pair is its own tid, so a
 * worker's spans and an overlapping segment mount never fight over one stack.
 *
 * Times are the main thread's `performance.now()` in microseconds. A worker's
 * events are moved onto that clock by subtracting the offset its handshake
 * measured (`traceWorkerProtocol.ts`).
 */
import { readTraceEvent, TRACE_KIND_COUNTER, TRACE_KIND_INSTANT, type TraceRingSnapshot } from './traceBuffer';

export interface TraceThreadInput {
  /** Thread label: 'main', 'sim worker', 'rapier worker'. */
  thread: string;
  snapshot: TraceRingSnapshot;
  /** This thread's clock minus the main thread's (ms); 0 for main. */
  offsetMs: number;
  /** Half the best handshake round trip (ms): the alignment's error bound. 0 for main. */
  alignErrorMs: number;
  /** The same offset from the threads' `performance.timeOrigin`s (absent for main). */
  originOffsetMs?: number;
}

export interface TraceMetadata {
  buildId: string;
  startedAt: string;
  url: string;
  durationMs: number;
}

interface ChromeTraceEvent {
  name: string;
  cat?: string;
  ph: 'X' | 'i' | 'C' | 'M';
  ts?: number;
  dur?: number;
  pid: number;
  tid: number;
  s?: 't' | 'p' | 'g';
  args?: Record<string, unknown>;
}

export interface PerfettoTrace {
  traceEvents: ChromeTraceEvent[];
  displayTimeUnit: 'ms';
  metadata: TraceMetadata & {
    threads: {
      thread: string;
      offsetMs: number;
      alignErrorMs: number;
      originOffsetMs: number | null;
      events: number;
      dropped: number;
    }[];
  };
}

const PID = 1;
/** Fixed tids for the threads' main rows, so a trace reads the same way every time. */
const THREAD_TID: Record<string, number> = { main: 1, 'sim worker': 2, 'rapier worker': 3 };

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function exportPerfetto(threads: readonly TraceThreadInput[], meta: TraceMetadata): PerfettoTrace {
  const events: ChromeTraceEvent[] = [
    { name: 'process_name', ph: 'M', pid: PID, tid: 0, args: { name: 'Watershed' } },
  ];
  const tids = new Map<string, number>();
  let nextTid = 10;
  const tidFor = (thread: string, track: string): number => {
    const key = `${thread}/${track}`;
    let tid = tids.get(key);
    if (tid !== undefined) return tid;
    tid = track === 'main' && THREAD_TID[thread] !== undefined ? THREAD_TID[thread] : nextTid++;
    tids.set(key, tid);
    const label = track === 'main' ? thread : `${thread}: ${track}`;
    events.push({ name: 'thread_name', ph: 'M', pid: PID, tid, args: { name: label } });
    events.push({ name: 'thread_sort_index', ph: 'M', pid: PID, tid, args: { sort_index: tid } });
    return tid;
  };

  for (const { thread, snapshot, offsetMs } of threads) {
    tidFor(thread, 'main');
    for (let i = 0; i < snapshot.count; i += 1) {
      const { kind, id, at, value } = readTraceEvent(snapshot.events, i);
      const name = snapshot.names[id] ?? `#${id}`;
      const track = snapshot.tracks[id] ?? 'main';
      const ts = round3((at - offsetMs) * 1000);
      if (kind === TRACE_KIND_COUNTER) {
        events.push({ name, ph: 'C', ts, pid: PID, tid: 0, args: { value } });
      } else if (kind === TRACE_KIND_INSTANT) {
        events.push({ name, cat: thread, ph: 'i', s: 't', ts, pid: PID, tid: tidFor(thread, track) });
      } else {
        events.push({ name, cat: thread, ph: 'X', ts, dur: round3(value * 1000), pid: PID, tid: tidFor(thread, track) });
      }
    }
  }

  return {
    traceEvents: events,
    displayTimeUnit: 'ms',
    metadata: {
      ...meta,
      threads: threads.map((t) => ({
        thread: t.thread,
        offsetMs: t.offsetMs,
        alignErrorMs: t.alignErrorMs,
        originOffsetMs: t.originOffsetMs ?? null,
        events: t.snapshot.count,
        dropped: t.snapshot.dropped,
      })),
    },
  };
}
