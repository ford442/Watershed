/**
 * traceSession — record one timeline across every thread (#559 D).
 *
 * Lazy (`traceControl.ts` imports it on demand): a session that never records
 * never loads the ring, the exporter or this file. `startTraceSession()`:
 *
 *   1. installs the main thread's ring (`traceBuffer.ts`) as the probe's sink;
 *   2. connects every registered worker (`traceWorkers.ts`) over a fresh
 *      MessageChannel, measures its clock offset with a SYNC ping-pong (best
 *      of `SYNC_ROUNDS` by round trip), then tells it to START — and does the
 *      same for any worker created while it records (the Rapier worker of a
 *      raft run, the sim worker under `?trace=1`, which records from boot);
 *   3. watches `longtask` entries (Chromium) and samples the JS heap
 *      (`performance.memory`, Chromium) as a counter: a heap drop is a GC —
 *      the page has no GC event to observe, only DevTools does.
 *
 * `stop()` re-measures each offset on a quiet page, keeps whichever handshake
 * had the shorter round trip (the threads share one monotonic clock, so the
 * offset is a constant: the better measurement wins), flushes every worker and
 * returns the Perfetto JSON (`exportPerfetto.ts`).
 */
import { BUILD_IDENTITY } from '../../buildIdentity';
import { createTraceRing, DEFAULT_TRACE_CAPACITY, type TraceRingSnapshot } from './traceBuffer';
import { exportPerfetto, type PerfettoTrace, type TraceThreadInput } from './exportPerfetto';
import { installTraceSink, traceCounter, traceName, traceNameTable, traceNow, traceSpanAt } from './traceProbe';
import { onTraceWorkerRegistered, traceWorkerConnectors, type TraceConnector } from './traceWorkers';
import type { TraceWorkerCommand, TraceWorkerReply } from './traceWorkerProtocol';

const SYNC_ROUNDS = 16;
/** A booting worker (WASM load, a busy page) can take seconds to answer its first SYNC. */
const FIRST_SYNC_TIMEOUT_MS = 30_000;
const FLUSH_TIMEOUT_MS = 2000;
const HEAP_SAMPLE_MS = 100;

const LONGTASK = traceName('longtask', 'longtask');
const HEAP_MB = traceName('js heap MB');

interface Offset {
  offsetMs: number;
  /** Half the round trip of the sample used. */
  errorMs: number;
  /** Main `timeOrigin` minus the worker's: the same offset from the clocks' origins. */
  originOffsetMs: number;
}

interface WorkerLink {
  thread: string;
  port: MessagePort;
  start: Promise<Offset | null>;
  request(command: TraceWorkerCommand): void;
  next(type: TraceWorkerReply['type'], timeoutMs: number): Promise<TraceWorkerReply | null>;
}

function openLink(thread: string, connect: TraceConnector, capacity: number): WorkerLink {
  const channel = new MessageChannel();
  const waiters: { type: TraceWorkerReply['type']; resolve: (r: TraceWorkerReply | null) => void }[] = [];
  channel.port1.onmessage = (event: MessageEvent<TraceWorkerReply>) => {
    const i = waiters.findIndex((w) => w.type === event.data.type);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(event.data);
  };
  const link: WorkerLink = {
    thread,
    port: channel.port1,
    start: Promise.resolve(null),
    request: (command) => channel.port1.postMessage(command),
    next: (type, timeoutMs) =>
      new Promise((resolve) => {
        const waiter = { type, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) {
            waiters.splice(i, 1);
            resolve(null);
          }
        }, timeoutMs);
      }),
  };
  connect(channel.port2);
  link.start = measureOffset(link).then((offset) => {
    if (offset) link.request({ type: 'START', capacity });
    return offset;
  });
  return link;
}

/** Best-of-N SYNC ping-pong; null when the worker never answers. */
async function measureOffset(link: WorkerLink): Promise<Offset | null> {
  let best: Offset | null = null;
  for (let seq = 0; seq < SYNC_ROUNDS; seq += 1) {
    const sentAt = traceNow();
    link.request({ type: 'SYNC', seq, sentAt });
    const reply = await link.next('SYNC', seq === 0 ? FIRST_SYNC_TIMEOUT_MS : FLUSH_TIMEOUT_MS);
    if (!reply || reply.type !== 'SYNC') return best;
    const receivedAt = traceNow();
    const errorMs = (receivedAt - sentAt) / 2;
    if (!best || errorMs < best.errorMs) {
      best = {
        offsetMs: reply.workerAt - (sentAt + receivedAt) / 2,
        errorMs,
        originOffsetMs: performance.timeOrigin - reply.origin,
      };
    }
  }
  return best;
}

export interface TraceSession {
  readonly startedAt: number;
  /** Stop recording everywhere and build the timeline. */
  stop(): Promise<PerfettoTrace>;
}

export interface TraceSessionOptions {
  /** Events per thread ring. */
  capacity?: number;
}

let active: TraceSession | null = null;

export function activeTraceSession(): TraceSession | null {
  return active;
}

export function startTraceSession(options: TraceSessionOptions = {}): TraceSession {
  if (active) return active;
  const capacity = options.capacity ?? DEFAULT_TRACE_CAPACITY;
  const ring = createTraceRing(capacity);
  const startedAt = traceNow();
  const startedIso = new Date().toISOString();
  installTraceSink(ring);

  const links: WorkerLink[] = [];
  const connect = (thread: string, connector: TraceConnector) => {
    links.push(openLink(thread, connector, capacity));
  };
  for (const [thread, connector] of traceWorkerConnectors()) connect(thread, connector);
  onTraceWorkerRegistered(connect);

  let longtasks: PerformanceObserver | null = null;
  try {
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longtasks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) traceSpanAt(LONGTASK, entry.startTime, entry.startTime + entry.duration);
      });
      longtasks.observe({ type: 'longtask' });
    }
  } catch {
    longtasks = null;
  }
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const heapTimer = memory
    ? setInterval(() => traceCounter(HEAP_MB, Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10), HEAP_SAMPLE_MS)
    : null;

  const session: TraceSession = {
    startedAt,
    async stop() {
      onTraceWorkerRegistered(null);
      longtasks?.disconnect();
      if (heapTimer !== null) clearInterval(heapTimer);
      const stoppedAt = traceNow();
      installTraceSink(null);
      const table = traceNameTable();
      const threads: TraceThreadInput[] = [
        { thread: 'main', snapshot: ring.snapshot(table.names, table.tracks), offsetMs: 0, alignErrorMs: 0 },
      ];
      const workers = await Promise.all(links.map((link) => flushLink(link)));
      for (const w of workers) if (w) threads.push(w);
      active = null;
      return exportPerfetto(threads, {
        buildId: BUILD_IDENTITY,
        startedAt: startedIso,
        url: typeof location !== 'undefined' ? location.href : '',
        durationMs: Math.round(stoppedAt - startedAt),
      });
    },
  };
  active = session;
  return session;
}

async function flushLink(link: WorkerLink): Promise<TraceThreadInput | null> {
  const first = await link.start;
  if (!first) {
    link.port.close();
    return null;
  }
  // Re-measure on a (usually) quiet page; the shorter round trip is the better estimate.
  const second = await measureOffset(link);
  const best = second && second.errorMs < first.errorMs ? second : first;
  link.request({ type: 'FLUSH' });
  const reply = await link.next('FLUSH', FLUSH_TIMEOUT_MS);
  link.port.close();
  if (!reply || reply.type !== 'FLUSH') return null;
  const snapshot: TraceRingSnapshot = reply.snapshot;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    thread: link.thread,
    snapshot,
    offsetMs: best.offsetMs,
    alignErrorMs: r3(best.errorMs),
    originOffsetMs: r3(best.originOffsetMs),
  };
}
