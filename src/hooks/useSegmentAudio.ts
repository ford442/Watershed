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
import { getAudioManager } from '../systems/AudioSystem';

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
        audio.setAmbient('rapids_roar', 2000);
        break;
      case 'waterfall':
        // Peak waterfall roar
        audio.setAmbient('rapids_roar', 800);
        break;
      case 'splash':
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
}

export default useSegmentAudio;
