/**
 * traceWorkerSide — a worker's end of the trace port (#559 D).
 *
 * Loaded by the sim worker and the Rapier worker on `TRACE_CONNECT` (a dynamic
 * import, so a session that never records never loads it). Answers the clock
 * handshake straight away, installs this thread's ring on START, and sends the
 * ring back on FLUSH.
 */
import { createTraceRing, type TraceRing } from './traceBuffer';
import { installTraceSink, traceNameTable, traceNow } from './traceProbe';
import type { TraceWorkerCommand, TraceWorkerReply } from './traceWorkerProtocol';

export function attachWorkerTrace(port: MessagePort): void {
  let ring: TraceRing | null = null;
  const reply = (message: TraceWorkerReply, transfer: Transferable[] = []) => port.postMessage(message, transfer);
  port.onmessage = (event: MessageEvent<TraceWorkerCommand>) => {
    const command = event.data;
    switch (command.type) {
      case 'SYNC':
        reply({ type: 'SYNC', seq: command.seq, sentAt: command.sentAt, workerAt: traceNow(), origin: performance.timeOrigin });
        return;
      case 'START':
        ring = createTraceRing(command.capacity);
        installTraceSink(ring);
        return;
      case 'FLUSH': {
        installTraceSink(null);
        const table = traceNameTable();
        const snapshot = ring
          ? ring.snapshot(table.names, table.tracks)
          : { names: [], tracks: [], events: new Float64Array(0), count: 0, dropped: 0 };
        ring = null;
        reply({ type: 'FLUSH', snapshot }, [snapshot.events.buffer]);
        port.close();
        return;
      }
    }
  };
}
