/**
 * useSegmentAudio — Segment-aware ambient audio manager
 *
 * Manages ambient sound transitions based on player segment position:
 * - Segments 0-12: ambient_water (gentle river)
 * - Segment 13: waterfall sound fades in
 * - Segment 14: waterfall sound at peak
 * - Segment 15+: ambient pond sounds
 *
 * Uses the global AudioManager singleton for fade in/out.
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getAudioManager } from '../systems/AudioSystem';
import { useGameStore } from '../systems/GameState';

export type SegmentAudioPhase = 'meander' | 'approach' | 'waterfall' | 'splash' | 'pond' | 'rapids';

const PHASE_MAP: Record<number, SegmentAudioPhase> = {
  13: 'approach',
  14: 'waterfall',
  15: 'splash',
  16: 'pond',
  17: 'pond',
  18: 'pond',
};

function getPhase(segmentIndex: number): SegmentAudioPhase {
  if (segmentIndex <= 12) return 'meander';
  if (segmentIndex >= 19) return 'rapids';
  return PHASE_MAP[segmentIndex] ?? 'meander';
}

/**
 * Hook that drives ambient audio based on current segment index.
 * Call this from your main scene component (e.g. Experience.jsx).
 */
export function useSegmentAudio(currentSegmentIndex: number) {
  const lastPhaseRef = useRef<SegmentAudioPhase>('meander');
  const lastSegmentRef = useRef(-1);
  const flowSpeedRef = useRef(1);
  const volumesRef = useRef({ low: 1, high: 0 });
  const playerSpeed = useGameStore((s) => s.currentSpeed);

  useEffect(() => {
    // Debounce: only react when segment index actually changes
    if (currentSegmentIndex === lastSegmentRef.current) return;
    lastSegmentRef.current = currentSegmentIndex;

    const phase = getPhase(currentSegmentIndex);
    if (phase === lastPhaseRef.current) return;
    lastPhaseRef.current = phase;

    const audio = getAudioManager();
    if (!audio) return;

    switch (phase) {
      case 'approach':
        // Fade in waterfall ambience as we approach
        audio.setAmbient('rapids_roar', 1800);
        break;
      case 'waterfall':
        // Peak waterfall roar
        audio.setAmbient('rapids_roar', 600);
        audio.playSound('water_crash', 0.6);
        break;
      case 'splash':
        audio.setAmbient('ambient_water', 1800);
        audio.playSound('water_crash', 0.35);
        break;
      case 'pond':
        // Transition to calm water ambience
        audio.setAmbient('ambient_water', 2500);
        break;
      case 'rapids':
        // Moderate rapids ambience
        audio.setAmbient('rapids_roar', 2000);
        break;
      case 'meander':
      default:
        audio.setAmbient('ambient_water', 3000);
        break;
    }
  }, [currentSegmentIndex]);

  useEffect(() => {
    const onFlow = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && isFinite(detail.flowSpeed)) {
        flowSpeedRef.current = detail.flowSpeed;
      }
    };
    window.addEventListener('water-flow-update', onFlow);
    return () => window.removeEventListener('water-flow-update', onFlow);
  }, []);

  useFrame((_, delta) => {
    const audio = getAudioManager();
    if (!audio || !isFinite(delta) || delta <= 0) return;

    const flowSpeed = isFinite(flowSpeedRef.current) ? flowSpeedRef.current : 1;
    const speed = isFinite(playerSpeed) ? playerSpeed : 0;
    const phase = lastPhaseRef.current;

    const targetLow = THREE.MathUtils.clamp(1 - flowSpeed * 0.5, 0, 1);
    const targetHigh = THREE.MathUtils.clamp((flowSpeed - 0.8) / 0.5, 0, 1);
    const speedWhoosh = THREE.MathUtils.clamp((speed - 8) / 20, 0, 1);
    const waterfallRoar =
      phase === 'approach' ? 0.55 :
      phase === 'waterfall' ? 1.0 :
      phase === 'splash' ? 0.5 : 0;

    const lerp = Math.min(1, delta * 2);
    volumesRef.current.low += (targetLow - volumesRef.current.low) * lerp;
    volumesRef.current.high += (targetHigh - volumesRef.current.high) * lerp;

    audio.setReactiveVolumes({
      low: volumesRef.current.low,
      high: Math.max(volumesRef.current.high, waterfallRoar),
      whoosh: Math.max(speedWhoosh, waterfallRoar * 0.6),
      transition: waterfallRoar,
    });
  });
}

export default useSegmentAudio;
