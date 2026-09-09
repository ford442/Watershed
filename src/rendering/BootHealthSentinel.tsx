/**
 * BootHealthSentinel — clears the boot-crash guard once the render loop is real.
 *
 * Must live inside <Canvas>: the whole point is that `useFrame` only ticks when
 * a WebGL context exists, the scene graph committed, and frames are actually
 * being produced. A boot that dies before that never clears the flag, and the
 * next start clamps itself (see `bootCrashGuard.ts`).
 *
 * Costs one counter increment per frame until the threshold, then a single
 * early-return branch for the rest of the session. It deliberately does not
 * re-render to unsubscribe: a state update inside `useFrame` is a worse trade
 * than a predictable no-op callback.
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { HEALTHY_FRAME_COUNT, markBootHealthy } from './bootCrashGuard';

export interface BootHealthSentinelProps {
  /** Frames to wait before declaring the boot healthy. */
  frames?: number;
  /** Called once, when the threshold is reached. */
  onHealthy?: () => void;
}

export default function BootHealthSentinel({
  frames = HEALTHY_FRAME_COUNT,
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
