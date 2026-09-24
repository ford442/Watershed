/**
 * useCanyonAcoustics — drive AudioManager's canyon acoustics from the biome.
 *
 * Acoustics used to switch on only for ReactiveAudio's segments 20–22 (a
 * hard-coded slot-canyon window on the reach path), so `?map=glacial` and
 * `?map=delta` sounded the same. The walls are already described per biome —
 * `TrackBiomeProfile.wallTightness` shapes the canyon geometry — so the audio
 * reads the same number: an ice tube or slot canyon encloses, a delta does not.
 *
 * Call after `initAudio(camera)` has run (effects fire in declaration order).
 */

import { useEffect } from 'react';
import { TRACK_BIOMES, normalizeBiomeId } from '../configs/TrackBiomes';
import { getAudioManager } from '../systems/audio/AudioSystem';
import { isEnclosedReach, wallWetnessForBiome } from '../systems/audio/canyonAcoustics';
import { useGameStore } from '../systems/GameState';

export function applyBiomeAcoustics(biome: string): void {
  const am = getAudioManager();
  if (!am) return;
  const id = normalizeBiomeId(biome);
  const tightness = TRACK_BIOMES[id]?.wallTightness ?? 0;
  if (isEnclosedReach(tightness)) {
    am.enableCanyonAcoustics(tightness, wallWetnessForBiome(id));
  } else {
    am.disableCanyonAcoustics();
  }
}

export function useCanyonAcoustics(): void {
  const biome = useGameStore((s) => s.currentBiome);

  useEffect(() => {
    applyBiomeAcoustics(biome);
  }, [biome]);

  // resetRunSession clears acoustics after dispatching the reset event; put
  // the current biome's walls back once that synchronous teardown is done.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onRunReset = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        applyBiomeAcoustics(useGameStore.getState().currentBiome);
      }, 0);
    };
    window.addEventListener('watershed-run-reset', onRunReset);
    return () => {
      window.removeEventListener('watershed-run-reset', onRunReset);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
}

export default useCanyonAcoustics;
