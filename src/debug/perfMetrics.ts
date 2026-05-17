/**
 * perfMetrics.ts — Shared performance metrics store
 *
 * Lives at module level so it crosses the R3F Canvas boundary:
 * PerfCheckpointMonitor (inside Canvas) writes here,
 * DebugPanel (outside Canvas, in DOM) reads here.
 *
 * Not using Zustand/React state to avoid triggering re-renders on every frame.
 * The panel subscribes once and pulls data on a 30-frame cadence.
 */

export interface PerfMetrics {
  /** Three.js draw call count for the last measured frame */
  drawCalls: number;
  /** Triangle count for the last measured frame */
  triangles: number;
  /** Number of geometry objects alive on the GPU */
  geometries: number;
  /** Number of textures alive on the GPU */
  textures: number;
  /** Average frame time in milliseconds over last 30 frames */
  frameTimeMs: number;
  /** Derived FPS from frameTimeMs */
  fps: number;
  /** JS heap usage in MB (Chrome only; 0 on other browsers) */
  memoryMB: number;
}

const _metrics: PerfMetrics = {
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  frameTimeMs: 0,
  fps: 0,
  memoryMB: 0,
};

type Listener = () => void;
const _listeners = new Set<Listener>();

/** Read current metrics snapshot */
export function getPerfMetrics(): Readonly<PerfMetrics> {
  return _metrics;
}

/** Write new metrics and notify subscribers (called from PerfCheckpointMonitor) */
export function updatePerfMetrics(partial: Partial<PerfMetrics>): void {
  Object.assign(_metrics, partial);
  _listeners.forEach((fn) => fn());
}

/** Subscribe to metric updates. Returns an unsubscribe function. */
export function subscribePerfMetrics(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
