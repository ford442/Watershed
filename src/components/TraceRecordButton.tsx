import { useEffect, useState } from 'react';
import { queryFlags } from '../config/queryFlags';
import { lazyModule } from '../utils/lazyModule';

/**
 * The F3 panel's trace control (#559 D): "Record 10 s" records every thread's
 * spans and downloads `watershed-<build>.trace.json` (open it in
 * ui.perfetto.dev). On a `?trace=1` page, which records from boot, it reads
 * "Stop & save". Shift+F3 does the same (MovementReadout.tsx). Only on a
 * `?debug=1` / `?trace=1` page; the control module is a lazy chunk.
 */
const control = lazyModule(() => import('../debug/trace/traceControl'));

function traceControlsEnabled(): boolean {
  const flags = queryFlags();
  return flags.debug || flags.trace;
}

/** Record 10 s and save, or stop and save a running recording (Shift+F3 does the same: MovementReadout.tsx). */
function toggleTraceRecording(): void {
  if (!traceControlsEnabled()) return;
  void control.load().then((m) => m.recordAndSave());
}

export default function TraceRecordButton() {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    let off: (() => void) | null = null;
    let live = true;
    void control.load().then((m) => {
      if (!live) return;
      setRecording(m.isTraceRecording());
      off = m.onTraceRecordingChange(setRecording);
    });
    return () => {
      live = false;
      off?.();
    };
  }, []);

  if (!traceControlsEnabled()) return null;
  return (
    <button
      type="button"
      className="move-readout__trace"
      data-testid="trace-record"
      onClick={toggleTraceRecording}
    >
      {recording ? 'Stop & save trace' : 'Record 10 s trace'}
    </button>
  );
}
