/**
 * FrameWorkTimer — brackets each frame for `frameWork.ts` (#466 Phase B).
 *
 * Uses R3F's global before/after effects rather than useFrame priorities: a
 * positive-priority useFrame would switch off R3F's own render when post is not
 * mounted, and the after-effect runs once every root (and the post chain's
 * manual render) is done. It also owns `renderer.info` for the frame
 * (`frameRenderInfo.ts`). Renders nothing; must live inside <Canvas>.
 */
import { useEffect } from 'react';
import { addAfterEffect, addEffect, useThree } from '@react-three/fiber';
import { createGpuTimer } from './gpuTimer';
import { attachGpuTimer, beginFrameWork, endFrameWork, getFrameWork } from './frameWork';
import { updatePerfMetrics } from '../debug/perfMetrics';
import { attachFrameRenderInfo, type RendererInfoLike } from './frameRenderInfo';
import { traceCounter, traceName, traceRecording, traceSpanAt } from '../debug/trace/traceProbe';

/** The whole frame's CPU work, and the GPU frame time as a counter track (#559 D). */
const FRAME_SPAN = traceName('frame');
const GPU_COUNTER = traceName('gpu frame ms');

/** Frames between debug-panel pushes (matches PerfCheckpointMonitor). */
const PUBLISH_INTERVAL = 30;

export default function FrameWorkTimer() {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    attachGpuTimer(createGpuTimer(gl));
    // One `info.reset()` per frame instead of one per render(): the post chain
    // renders 6–9 times a frame and only the last pass used to be counted.
    const detachRenderInfo = attachFrameRenderInfo(gl.info as unknown as RendererInfoLike);
    let frames = 0;
    let cpuSum = 0;
    // Both global effects receive the same rAF timestamp, so time with now().
    let frameStart = 0;
    const removeBefore = addEffect(() => {
      frameStart = performance.now();
      beginFrameWork(frameStart);
    });
    const removeAfter = addAfterEffect(() => {
      const end = performance.now();
      endFrameWork(end);
      const s = getFrameWork();
      if (traceRecording()) {
        traceSpanAt(FRAME_SPAN, frameStart, end);
        // Resolved 2–4 frames late (gpuTimer.ts): the counter lags its frame by that much.
        if (s.gpuMs !== null) traceCounter(GPU_COUNTER, s.gpuMs);
      }
      cpuSum += s.cpuWorkMs;
      frames += 1;
      if (frames >= PUBLISH_INTERVAL) {
        updatePerfMetrics({
          cpuWorkMs: Math.round((cpuSum / frames) * 10) / 10,
          gpuMs: s.gpuMs === null ? null : Math.round(s.gpuMs * 10) / 10,
          gpuTimerSource: s.source,
        });
        frames = 0;
        cpuSum = 0;
      }
    });
    return () => {
      removeBefore();
      removeAfter();
      detachRenderInfo();
      attachGpuTimer(null);
    };
  }, [gl]);

  return null;
}
