/**
 * frameWork — how long a frame actually took to *work*, as opposed to how long
 * rAF waited for vsync (#466 Phase B).
 *
 * `FrameWorkTimer` brackets every frame with R3F's global effects:
 * `addEffect` (before any root's useFrame callbacks) and `addAfterEffect`
 * (after every root has rendered, post-processing included). The span between
 * them is the frame's CPU work; the GPU timer bracketing the same span gives
 * GPU time a few frames later. LODManager feeds `frameWorkMs()` (the larger of
 * the two) to the render-scale valve, so a vsync-capped 60 Hz display can show
 * the valve a 9 ms frame instead of a quantised 16.7 ms one.
 *
 * Module-level like `debug/perfMetrics.ts`: written inside the Canvas, read by
 * LODManager (inside) and the debug panel (outside), with no React state.
 */
import type { GpuTimer, GpuTimerSource } from './gpuTimer';

export interface FrameWorkSample {
  /** CPU ms from the first frame callback to the end of the last render. 0 until measured. */
  cpuWorkMs: number;
  /** Latest resolved GPU frame ms, or null without a GPU timer (or before the first readback). */
  gpuMs: number | null;
  source: GpuTimerSource;
}

const sample: FrameWorkSample = { cpuWorkMs: 0, gpuMs: null, source: 'cpu-fallback' };
let timer: GpuTimer | null = null;
let frameStart = -1;

export function attachGpuTimer(next: GpuTimer | null): void {
  timer?.dispose();
  timer = next;
  sample.source = next?.source ?? 'cpu-fallback';
  sample.gpuMs = null;
}

export function beginFrameWork(now: number): void {
  frameStart = now;
  timer?.begin();
}

export function endFrameWork(now: number): void {
  if (frameStart < 0) return;
  timer?.end();
  sample.cpuWorkMs = Math.max(0, now - frameStart);
  sample.gpuMs = timer?.gpuMs ?? null;
  frameStart = -1;
}

export function getFrameWork(): Readonly<FrameWorkSample> {
  return sample;
}

/** The frame's binding cost: GPU time when known, never less than the CPU work. */
export function frameWorkMs(s: Readonly<FrameWorkSample>): number {
  return Math.max(s.gpuMs ?? 0, s.cpuWorkMs);
}

/** Test seam. */
export function resetFrameWork(): void {
  attachGpuTimer(null);
  sample.cpuWorkMs = 0;
  frameStart = -1;
}

export interface FrameWindowSummary {
  /** Mean rAF interval — what the player sees as FPS. */
  meanFrameMs: number;
  fps: number;
  /** What the adaptive valve and ladder act on — see `summarizeFrameWindow`. */
  meanWorkMs: number;
  workSource: 'gpu' | 'cpu' | 'raf';
}

export interface FrameWindowOptions {
  /** True when the window's work samples include GPU time. */
  gpuTimed: boolean;
  /**
   * rAF interval past which a frame demonstrably missed vsync (the valve's slow
   * line). Without a GPU timer, CPU work can't see a GPU-bound frame, but rAF
   * can: past this line the window reports rAF time, so the valve still closes
   * under GPU load instead of reopening into it.
   */
  missedFrameMs: number;
}

/**
 * One adaptive window (≈60 frames).
 *   gpu  GPU timer present: mean of max(gpuMs, cpuWorkMs).
 *   cpu  No GPU timer: mean CPU work, unless rAF says frames were missed.
 *   raf  No work samples at all (FrameWorkTimer not mounted) or rAF missed
 *        frames on the CPU fallback: the pre-#466 behaviour.
 */
export function summarizeFrameWindow(
  rafMs: readonly number[],
  workMs: readonly number[],
  options: FrameWindowOptions,
): FrameWindowSummary {
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const meanFrameMs = mean(rafMs);
  const fps = meanFrameMs > 0 ? Math.round(1000 / meanFrameMs) : 0;
  const measured = workMs.filter((w) => w > 0);
  if (measured.length === 0) return { meanFrameMs, fps, meanWorkMs: meanFrameMs, workSource: 'raf' };
  const meanWork = mean(measured);
  if (options.gpuTimed) return { meanFrameMs, fps, meanWorkMs: meanWork, workSource: 'gpu' };
  if (meanFrameMs > options.missedFrameMs && meanFrameMs > meanWork) {
    return { meanFrameMs, fps, meanWorkMs: meanFrameMs, workSource: 'raf' };
  }
  return { meanFrameMs, fps, meanWorkMs: meanWork, workSource: 'cpu' };
}
