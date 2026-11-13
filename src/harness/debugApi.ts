/**
 * debugApi — the harness's single `window.__watershed` object (#535 C).
 *
 * Production code leaves its diagnostics in `src/debug/debugTaps.ts` (module state, no
 * `window`); this lazy chunk, loaded from `src/index.tsx` only when
 * `queryFlags().debugGlobals` (`?debug`, `?physicsDebug`, `?screenshot`), publishes them
 * as live getters. The verification scripts and the console read `window.__watershed.*`;
 * nothing in the entry chunk names it. (`window.__watershedScreenshot` is the screenshot
 * harness's own API, installed by `screenshotApi.ts` in this directory.)
 */
import { getDebugTap, type DebugTaps } from '../debug/debugTaps';
import { getSegmentFlowSpeed, getSegmentSlipperiness } from '../systems/water/segmentFlow';
import { isTraceRecording, startTrace, stopTrace } from '../debug/trace/traceControl';
import type { PerfettoTrace } from '../debug/trace/exportPerfetto';

export interface WatershedDebugApi {
  readonly physicsDebug: DebugTaps['physicsDebug'];
  readonly physicsPerf: DebugTaps['physicsPerf'];
  readonly waterForce: DebugTaps['waterForce'];
  readonly physicsWorker: DebugTaps['physicsWorker'];
  readonly obstaclePool: DebugTaps['obstaclePool'];
  readonly cameraDiag: DebugTaps['cameraDiag'];
  readonly wasmWaterTest: DebugTaps['wasmWaterTest'];
  readonly shaderWarmup: DebugTaps['shaderWarmup'];
  /** The entered segment's flow multiplier / slipperiness (systems/water/segmentFlow.ts). */
  readonly flowSpeed: number;
  readonly slipperiness: number;
  /** `?debugGpuLoss` only: force a context / device loss; null when not armed. */
  loseGpu(): string | null;
  /**
   * The one timeline (#559 D): `stop()` resolves to the Perfetto trace object
   * (null when nothing was recording). `?trace=1` starts it at boot;
   * verification/perf_trace_smoke.mjs stops it after the scripted run.
   */
  readonly trace: {
    start(): Promise<void>;
    stop(): Promise<PerfettoTrace | null>;
    recording(): boolean;
  };
}

declare global {
  interface Window {
    __watershed?: WatershedDebugApi;
  }
}

export function createDebugApi(): WatershedDebugApi {
  return {
    get physicsDebug() { return getDebugTap('physicsDebug'); },
    get physicsPerf() { return getDebugTap('physicsPerf'); },
    get waterForce() { return getDebugTap('waterForce'); },
    get physicsWorker() { return getDebugTap('physicsWorker'); },
    get obstaclePool() { return getDebugTap('obstaclePool'); },
    get cameraDiag() { return getDebugTap('cameraDiag'); },
    get wasmWaterTest() { return getDebugTap('wasmWaterTest'); },
    get shaderWarmup() { return getDebugTap('shaderWarmup'); },
    get flowSpeed() { return getSegmentFlowSpeed(); },
    get slipperiness() { return getSegmentSlipperiness(); },
    loseGpu() {
      return getDebugTap('loseGpu')?.() ?? null;
    },
    trace: { start: startTrace, stop: stopTrace, recording: isTraceRecording },
  };
}

export function installDebugApi(): void {
  if (typeof window === 'undefined' || window.__watershed) return;
  window.__watershed = createDebugApi();
}
