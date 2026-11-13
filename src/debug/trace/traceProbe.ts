/**
 * traceProbe — the always-loaded half of the one timeline (#559 D).
 *
 * Instrumented code (the frame bracket, the input hub, SimCore, the post chain,
 * segment mounts, the sim and Rapier workers) calls these functions on every
 * frame. With no recording they are a null check: `traceStart()` does not read
 * the clock and nothing allocates. A recording (`traceSession.ts`, lazy behind
 * `?trace=1` / `?debug=1`) installs a sink — the preallocated ring in
 * `traceBuffer.ts` — and every probe starts writing into it.
 *
 * Names are interned once, at module scope of the instrumented file
 * (`const SPAN = traceName('sim-core', 'main')`), so a hot path passes a small
 * integer and never builds a string. `track` is the timeline row the span lands
 * on: spans on one track must nest (Perfetto draws a track as one stack), so
 * anything that can overlap the frame — a segment mount, an async pack load —
 * names its own track.
 *
 * Worker-safe and dependency-free: the sim worker and the Rapier worker load
 * their own copy of this module (each thread has its own registry and sink),
 * and so does the Node campaign harness, where it stays off.
 */

/** Where a recording writes. Timestamps are this thread's `performance.now()` ms. */
export interface TraceSink {
  span(id: number, start: number, end: number): void;
  instant(id: number, at: number): void;
  counter(id: number, at: number, value: number): void;
}

const names: string[] = [];
const tracks: string[] = [];
const index = new Map<string, number>();
let sink: TraceSink | null = null;

/** Intern `name` on `track` (default: this thread's main row). Call at module scope, not per frame. */
export function traceName(name: string, track = 'main'): number {
  const key = `${track}\u0000${name}`;
  const known = index.get(key);
  if (known !== undefined) return known;
  const id = names.length;
  names.push(name);
  tracks.push(track);
  index.set(key, id);
  return id;
}

/** The interned table, id-indexed. Read by the exporter and the worker flush. */
export function traceNameTable(): { readonly names: readonly string[]; readonly tracks: readonly string[] } {
  return { names, tracks };
}

/** True while a recording is installed on this thread. */
export function traceRecording(): boolean {
  return sink !== null;
}

/** Install (or with null, remove) this thread's sink. Only the trace session and the worker side call it. */
export function installTraceSink(next: TraceSink | null): void {
  sink = next;
}

/** This thread's clock (ms). */
export function traceNow(): number {
  return performance.now();
}

/** Start of a span: the clock while recording, else 0 (no clock read). */
export function traceStart(): number {
  return sink !== null ? performance.now() : 0;
}

/** End of a span begun with `traceStart()`. A span that began before the recording did is dropped. */
export function traceEnd(id: number, start: number): void {
  if (sink !== null && start > 0) sink.span(id, start, performance.now());
}

/** A span with both ends already measured (e.g. a user-timing measure). */
export function traceSpanAt(id: number, start: number, end: number): void {
  if (sink !== null) sink.span(id, start, end);
}

/** A value on a counter track (GPU ms, heap MB). */
export function traceCounter(id: number, value: number): void {
  if (sink !== null) sink.counter(id, performance.now(), value);
}
