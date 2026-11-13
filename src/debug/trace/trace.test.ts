import { afterEach, describe, expect, it } from 'vitest';
import { createTraceRing, readTraceEvent, TRACE_KIND_COUNTER, TRACE_KIND_SPAN } from './traceBuffer';
import { exportPerfetto } from './exportPerfetto';
import {
  installTraceSink,
  traceCounter,
  traceEnd,
  traceName,
  traceNameTable,
  traceRecording,
  traceStart,
} from './traceProbe';
import { registerTraceWorker } from './traceWorkers';
import { startTraceSession } from './traceSession';
import type { TraceWorkerCommand, TraceWorkerReply } from './traceWorkerProtocol';

afterEach(() => installTraceSink(null));

describe('traceProbe', () => {
  it('reads no clock and records nothing without a sink', () => {
    expect(traceRecording()).toBe(false);
    expect(traceStart()).toBe(0);
    const ring = createTraceRing(8);
    traceEnd(traceName('x'), 0);
    expect(ring.written).toBe(0);
  });

  it('interns a (track, name) pair once', () => {
    const a = traceName('probe-intern', 'main');
    expect(traceName('probe-intern', 'main')).toBe(a);
    expect(traceName('probe-intern', 'other')).not.toBe(a);
    expect(traceNameTable().tracks[traceName('probe-intern', 'other')]).toBe('other');
  });

  it('writes spans and counters into the installed ring', () => {
    const ring = createTraceRing(8);
    installTraceSink(ring);
    const span = traceName('probe-span');
    const counter = traceName('probe-counter');
    const start = traceStart();
    expect(start).toBeGreaterThan(0);
    traceEnd(span, start);
    traceCounter(counter, 4.5);
    const table = traceNameTable();
    const snap = ring.snapshot(table.names, table.tracks);
    expect(snap.count).toBe(2);
    expect(readTraceEvent(snap.events, 0)).toMatchObject({ kind: TRACE_KIND_SPAN, id: span, at: start });
    expect(readTraceEvent(snap.events, 1)).toMatchObject({ kind: TRACE_KIND_COUNTER, id: counter, value: 4.5 });
  });

  it('drops a span that began before the recording', () => {
    const before = traceStart();
    const ring = createTraceRing(8);
    installTraceSink(ring);
    traceEnd(traceName('probe-early'), before);
    expect(ring.written).toBe(0);
  });
});

describe('traceBuffer', () => {
  it('keeps the newest events, oldest first, once it wraps', () => {
    const ring = createTraceRing(3);
    for (let i = 1; i <= 5; i += 1) ring.span(7, i, i + 0.5);
    const snap = ring.snapshot([], []);
    expect(snap.count).toBe(3);
    expect(snap.dropped).toBe(2);
    expect([0, 1, 2].map((i) => readTraceEvent(snap.events, i).at)).toEqual([3, 4, 5]);
    expect(readTraceEvent(snap.events, 0)).toMatchObject({ id: 7, value: 0.5 });
  });
});

describe('exportPerfetto', () => {
  it('moves worker events onto the main clock and gives each track its own tid', () => {
    const main = createTraceRing(4);
    main.span(0, 100, 101);
    main.span(1, 100.5, 120);
    const worker = createTraceRing(4);
    worker.span(0, 1100, 1102);
    const trace = exportPerfetto(
      [
        { thread: 'main', snapshot: main.snapshot(['frame', 'segment-mount'], ['main', 'segments']), offsetMs: 0, alignErrorMs: 0 },
        { thread: 'sim worker', snapshot: worker.snapshot(['STEP'], ['main']), offsetMs: 1000, alignErrorMs: 0.05 },
      ],
      { buildId: 'test', startedAt: '', url: '', durationMs: 10 },
    );
    const spans = trace.traceEvents.filter((e) => e.ph === 'X');
    const frame = spans.find((e) => e.name === 'frame')!;
    const mount = spans.find((e) => e.name === 'segment-mount')!;
    const step = spans.find((e) => e.name === 'STEP')!;
    expect(frame).toMatchObject({ ts: 100_000, dur: 1000, tid: 1 });
    expect(step).toMatchObject({ ts: 100_000, dur: 2000, tid: 2 });
    expect(mount.tid).not.toBe(frame.tid);
    const threadNames = trace.traceEvents.filter((e) => e.name === 'thread_name').map((e) => e.args?.name);
    expect(threadNames).toEqual(expect.arrayContaining(['main', 'main: segments', 'sim worker']));
    expect(trace.metadata.threads[1]).toMatchObject({ thread: 'sim worker', offsetMs: 1000, events: 1 });
  });
});

describe('traceSession', () => {
  it('aligns a worker clock through the SYNC handshake and merges its flush', async () => {
    const WORKER_AHEAD_MS = 5000;
    const off = registerTraceWorker('sim worker', (port) => {
      // A stand-in worker whose clock runs WORKER_AHEAD_MS ahead of this thread's.
      const ring = createTraceRing(4);
      port.onmessage = (event: MessageEvent<TraceWorkerCommand>) => {
        const command = event.data;
        const reply = (m: TraceWorkerReply) => port.postMessage(m);
        if (command.type === 'SYNC') {
          reply({
            type: 'SYNC',
            seq: command.seq,
            sentAt: command.sentAt,
            workerAt: performance.now() + WORKER_AHEAD_MS,
            origin: performance.timeOrigin - WORKER_AHEAD_MS,
          });
        } else if (command.type === 'START') {
          const at = performance.now() + WORKER_AHEAD_MS;
          ring.span(0, at, at + 1);
        } else {
          reply({ type: 'FLUSH', snapshot: ring.snapshot(['STEP'], ['main']) });
        }
      };
    });
    try {
      const session = startTraceSession({ capacity: 64 });
      expect(traceRecording()).toBe(true);
      traceEnd(traceName('session-span'), traceStart());
      await new Promise((r) => setTimeout(r, 20));
      const trace = await session.stop();
      expect(traceRecording()).toBe(false);
      const worker = trace.metadata.threads.find((t) => t.thread === 'sim worker')!;
      expect(worker.events).toBe(1);
      expect(Math.abs(worker.offsetMs - WORKER_AHEAD_MS)).toBeLessThan(worker.alignErrorMs + 1);
      expect(worker.originOffsetMs).toBeCloseTo(WORKER_AHEAD_MS, 3);
      const step = trace.traceEvents.find((e) => e.name === 'STEP')!;
      const local = trace.traceEvents.find((e) => e.name === 'session-span')!;
      // Both on the main thread's clock: within the test's 20 ms window of each other.
      expect(Math.abs(step.ts! - local.ts!)).toBeLessThan(1_000_000);
    } finally {
      off();
    }
  });
});
