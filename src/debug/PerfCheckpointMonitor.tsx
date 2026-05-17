/**
 * PerfCheckpointMonitor — R3F component (must live inside <Canvas>)
 *
 * Samples renderer stats and memory every 30 frames and pushes them
 * to the module-level perfMetrics store so the DOM DebugPanel can read them.
 * Renders nothing (returns null).
 */

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { updatePerfMetrics } from './perfMetrics';

const SAMPLE_INTERVAL = 30; // frames between metric snapshots

export default function PerfCheckpointMonitor() {
  const { gl } = useThree();
  const frameCount = useRef(0);
  const lastTimestamp = useRef<number>(performance.now());
  const frameAccumMs = useRef(0);

  useFrame((_, delta) => {
    frameAccumMs.current += delta * 1000; // delta is in seconds
    frameCount.current += 1;

    if (frameCount.current >= SAMPLE_INTERVAL) {
      const avgFrameMs = frameAccumMs.current / SAMPLE_INTERVAL;
      const fps = avgFrameMs > 0 ? Math.round(1000 / avgFrameMs) : 0;

      const info = gl.info;
      const memMB = (() => {
        try {
          // Chrome-only performance.memory API
          const mem = (performance as any).memory;
          return mem ? Math.round(mem.usedJSHeapSize / 1_048_576) : 0;
        } catch {
          return 0;
        }
      })();

      updatePerfMetrics({
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        frameTimeMs: Math.round(avgFrameMs * 10) / 10,
        fps,
        memoryMB: memMB,
      });

      frameCount.current = 0;
      frameAccumMs.current = 0;
      lastTimestamp.current = performance.now();
    }
  });

  return null;
}
