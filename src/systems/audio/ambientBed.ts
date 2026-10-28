/**
 * ambientBed.ts — AudioManager's looping ambient track and its crossfade.
 *
 * One bed at a time: a new request fades the current one out (and drops it
 * from canyon acoustics once silent) while the next loads and fades in on the
 * music channel. Fades run on the wall clock — they are presentation, not sim.
 */

import * as THREE from 'three';
import { SOUND_DEFS, resolveSoundFile } from './soundDefs';
import type { SoundLibrary } from './soundLibrary';
import type { AcousticRouter } from './acousticRouting';

export interface AmbientBed {
  /** Crossfade to `trackName` over `fadeDuration` ms — see AudioManager.setAmbient. */
  set(trackName: string, fadeDuration: number): void;
  /** Stop the bed outright (manager dispose). */
  stop(): void;
}

/** @param musicVolume Live music-channel multiplier, read once per fade-in. */
export function createAmbientBed(
  listener: THREE.AudioListener,
  library: SoundLibrary,
  acoustics: AcousticRouter,
  musicVolume: () => number,
): AmbientBed {
  let ambientTrack: THREE.Audio<AudioNode> | THREE.PositionalAudio | null = null;
  let ambientRequest = 0;

  return {
    set(trackName, fadeDuration) {
      // Only the latest request may install a track: loads can resolve out of
      // order (and all at once when the unlock gesture releases them).
      const request = ++ambientRequest;

      // Fade out current ambient
      if (ambientTrack) {
        const oldTrack = ambientTrack;
        ambientTrack = null;
        const startVol = oldTrack.getVolume();
        const fadeStart = Date.now();

        const fadeOut = () => {
          const elapsed = Date.now() - fadeStart;
          const t = Math.min(1, elapsed / fadeDuration);
          oldTrack.setVolume(startVol * (1 - t));

          if (t < 1) {
            requestAnimationFrame(fadeOut);
          } else {
            acoustics.unroute(oldTrack);
            oldTrack.stop();
          }
        };
        fadeOut();
      }

      // Load and fade in new track
      library.load(trackName).then(buffer => {
        if (!buffer || request !== ambientRequest) return;

        const track = new THREE.Audio(listener) as THREE.Audio<AudioNode>;
        ambientTrack = track;
        track.setBuffer(buffer);
        track.setLoop(true);
        track.setVolume(0);

        const def = SOUND_DEFS[trackName];
        const targetVol = (def?.baseVolume || 0.3) * musicVolume();
        const fadeStart = Date.now();

        const fadeIn = () => {
          const elapsed = Date.now() - fadeStart;
          const t = Math.min(1, elapsed / fadeDuration);
          ambientTrack?.setVolume(targetVol * t);

          if (t < 1) {
            requestAnimationFrame(fadeIn);
          }
        };

        track.play();
        acoustics.route(track, resolveSoundFile(trackName)?.file === 'rapids_roar.mp3' ? 'rapids' : 'bed');
        fadeIn();
      });
    },

    stop() {
      ambientTrack?.stop();
      ambientTrack = null;
    },
  };
}
