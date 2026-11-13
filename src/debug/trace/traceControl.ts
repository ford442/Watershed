/**
 * traceControl — start, stop and save a recording (#559 D).
 *
 * A lazy chunk: index.tsx loads it on a `?trace=1` page, the F3 panel's
 * button (`?debug=1` / `?trace=1`) and the harness API on first use. The
 * session itself (`traceSession.ts`) is one more lazy import.
 *
 *   `?trace=1`      records from boot; the F3 panel's button stops and saves.
 *   F3 → Record 10 s / Shift+F3   records ten seconds, then saves.
 *   `window.__watershed.trace`    { start, stop, recording } for the
 *                                 verification scripts (harness/debugApi.ts;
 *                                 perf_trace_smoke.mjs): `stop()` resolves to
 *                                 the trace object.
 */
import { BUILD_IDENTITY } from '../../buildIdentity';
import { queryFlags } from '../../config/queryFlags';
import { lazyModule } from '../../utils/lazyModule';
import type { PerfettoTrace } from './exportPerfetto';

const sessionModule = lazyModule(() => import('./traceSession'));

export const TRACE_RECORD_MS = 10_000;

type Listener = (recording: boolean) => void;
const listeners = new Set<Listener>();
let recording = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const notify = () => {
  for (const l of listeners) l(recording);
};

export function isTraceRecording(): boolean {
  return recording;
}

/** The F3 control's subscription. */
export function onTraceRecordingChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function startTrace(): Promise<void> {
  const mod = await sessionModule.load();
  mod.startTraceSession();
  recording = true;
  notify();
}

/** Stop the recording; null when none was running. */
export async function stopTrace(): Promise<PerfettoTrace | null> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const session = sessionModule.get()?.activeTraceSession() ?? null;
  if (!session) return null;
  const trace = await session.stop();
  recording = false;
  notify();
  return trace;
}

/** `watershed-<build>.trace.json`, the build identity made filename-safe. */
export function traceFileName(buildId = BUILD_IDENTITY): string {
  return `watershed-${buildId.replace(/[^A-Za-z0-9._-]+/g, '_')}.trace.json`;
}

export function downloadTrace(trace: PerfettoTrace): void {
  const blob = new Blob([JSON.stringify(trace)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = traceFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Record `ms` (default 10 s), then download. A running recording is stopped and saved instead. */
export async function recordAndSave(ms = TRACE_RECORD_MS): Promise<void> {
  if (recording) {
    const trace = await stopTrace();
    if (trace) downloadTrace(trace);
    return;
  }
  await startTrace();
  timer = setTimeout(() => {
    void stopTrace().then((trace) => {
      if (trace) downloadTrace(trace);
    });
  }, ms);
}

/** index.tsx, on a `?trace=1` page: record from boot. */
export function startBootTrace(): void {
  if (queryFlags().trace) void startTrace();
}
