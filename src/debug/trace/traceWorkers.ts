/**
 * traceWorkers — the workers a recording can reach (#559 D).
 *
 * A worker proxy registers a connector when it creates its worker: a function
 * that hands the worker one end of a fresh MessageChannel (`TRACE_CONNECT`).
 * Nothing is posted until a recording starts: `traceSession.ts` then connects
 * every registered worker, and any worker created while it records. All trace
 * traffic — the clock handshake, start, flush — rides that dedicated port, so
 * the workers' own protocols carry one extra command and nothing else.
 */

/** Hand the worker its end of the trace channel (transferred). */
export type TraceConnector = (port: MessagePort) => void;

type Listener = (thread: string, connect: TraceConnector) => void;

const connectors = new Map<string, TraceConnector>();
let listener: Listener | null = null;

/** Register a worker under a thread label ('sim worker', 'rapier worker'). Returns the unregister. */
export function registerTraceWorker(thread: string, connect: TraceConnector): () => void {
  connectors.set(thread, connect);
  listener?.(thread, connect);
  return () => {
    if (connectors.get(thread) === connect) connectors.delete(thread);
  };
}

/** The live connectors; the session connects each one. */
export function traceWorkerConnectors(): ReadonlyMap<string, TraceConnector> {
  return connectors;
}

/** The session's hook for workers created mid-recording (null to clear). */
export function onTraceWorkerRegistered(next: Listener | null): void {
  listener = next;
}
