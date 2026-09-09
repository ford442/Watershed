/**
 * BootHealthSentinel — clears the boot-crash record on the first rendered frame.
 *
 * Must live inside <Canvas>: the whole point is that `useFrame` only ticks when
 * a WebGL context exists, the scene graph committed, and the GPU actually drew.
 * A boot that dies before that leaves the record behind, and the next start
 * clamps itself (see `bootCrashGuard.ts`).
 *
 * One frame, not sixty. A cold boot on a slow-but-healthy machine can spend
 * seconds in shader compilation and WASM instantiation; holding the guard open
 * for a frame *count* would clamp exactly those machines for being slow rather
 * than broken. The question this guard answers is "does WebGL work here", and a
 * single drawn frame answers it.
 *
 * It re-arms naturally after a context loss: `webglcontextrestored` bumps the
 * Canvas epoch, this component remounts with the new context, and its first
 * frame clears the `context-lost` record the loss handler wrote.
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { FRAMES_TO_HEALTHY, markBootHealthy } from './bootCrashGuard';

export interface BootHealthSentinelProps {
  /** Frames to wait before declaring the boot healthy. Injectable for tests. */
  frames?: number;
  /** Called once, when the threshold is reached. */
  onHealthy?: () => void;
}

export default function BootHealthSentinel({
  frames = FRAMES_TO_HEALTHY,
  onHealthy,
}: BootHealthSentinelProps) {
  const rendered = useRef(0);
  const cleared = useRef(false);

  useFrame(() => {
    if (cleared.current) return;
    rendered.current += 1;
    if (rendered.current < frames) return;
    cleared.current = true;
    markBootHealthy();
    onHealthy?.();
  });

  return null;
}
