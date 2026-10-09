/**
 * FrameWorkTimer — brackets each frame for `frameWork.ts` (#466 Phase B).
 *
 * Uses R3F's global before/after effects rather than useFrame priorities: a
 * positive-priority useFrame would switch off R3F's own render when post is not
 * mounted, and the after-effect runs once every root (and the post chain's
 * manual render) is done. Renders nothing; must live inside <Canvas>.
 */
import { useEffect } from 'react';
import { addAfterEffect, addEffect, useThree } from '@react-three/fiber';
import { createGpuTimer } from './gpuTimer';
import { attachGpuTimer, beginFrameWork, endFrameWork, getFrameWork } from './frameWork';
import { updatePerfMetrics } from '../debug/perfMetrics';

/** Frames between debug-panel pushes (matches PerfCheckpointMonitor). */
const PUBLISH_INTERVAL = 30;

export default function FrameWorkTimer() {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    attachGpuTimer(createGpuTimer(gl));
    let frames = 0;
    let cpuSum = 0;
    // Both global effects receive the same rAF timestamp, so time with now().
    const removeBefore = addEffect(() => beginFrameWork(performance.now()));
    const removeAfter = addAfterEffect(() => {
      endFrameWork(performance.now());
      const s = getFrameWork();
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
      attachGpuTimer(null);
    };
  }, [gl]);

  return null;
}
