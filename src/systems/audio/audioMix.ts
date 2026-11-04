/**
 * audioMix.ts — AudioManager's channel mix and reactive layer volumes.
 *
 * Master is the listener's global gain (mute parks it at 0 and restores it);
 * music and SFX are per-channel multipliers the settings panel drives, applied
 * on TOP of the biome/speed ducking (never an override). The SFX channel is
 * further scaled by the survival wetness muffle (wetnessMuffle.ts). The
 * reactive volumes are the crossfade levels ReactiveAudio / SpeedWindAudio
 * publish for the diagnostics overlay.
 */

import type * as THREE from 'three';
import { currentWetnessMuffle } from './wetnessMuffle';

export interface ReactiveVolumes {
  low: number;
  mid: number;
  high: number;
  rapids: number;
  whoosh: number;
  transition: number;
  /** Normalized speed-wind gain 0–1 (pre SFX/master multipliers). */
  wind?: number;
}

export interface AudioMix {
  setMaster(volume: number): void;
  setMuted(muted: boolean): void;
  muted(): boolean;
  setMusic(volume: number): void;
  music(): number;
  setSfx(volume: number): void;
  /** The raw settings value — what the settings panel reads back. */
  sfx(): number;
  /** SFX channel × live wetness muffle — what a one-shot actually multiplies by. */
  effectiveSfxGain(): number;
  setReactive(volumes: Partial<ReactiveVolumes>): void;
  /** A copy of the reactive crossfade volumes. */
  reactive(): ReactiveVolumes;
}

const clampUnit = (volume: number) => Math.max(0, Math.min(1, volume));

export function createAudioMix(listener: THREE.AudioListener): AudioMix {
  let isMuted = false;
  let masterVolume = 1.0;
  let musicVolume = 1.0;
  let sfxVolume = 1.0;
  // Populated by ReactiveAudio / SpeedWindAudio if mounted.
  let reactiveVolumes: ReactiveVolumes = {
    low: 0,
    mid: 0,
    high: 0,
    rapids: 0,
    whoosh: 0,
    transition: 0,
    wind: 0,
  };

  return {
    setMaster(volume) {
      masterVolume = clampUnit(volume);
      if (!isMuted) {
        listener.setMasterVolume(masterVolume);
      }
    },
    setMuted(muted) {
      isMuted = muted;
      listener.setMasterVolume(muted ? 0 : masterVolume);
    },
    muted: () => isMuted,
    setMusic(volume) {
      musicVolume = clampUnit(volume);
    },
    music: () => musicVolume,
    setSfx(volume) {
      sfxVolume = clampUnit(volume);
    },
    sfx: () => sfxVolume,
    effectiveSfxGain: () => sfxVolume * currentWetnessMuffle().gain,
    setReactive(volumes) {
      reactiveVolumes = { ...reactiveVolumes, ...volumes };
    },
    reactive: () => ({ ...reactiveVolumes }),
  };
}
