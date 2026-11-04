/**
 * synthBuffers.ts — AudioManager's synthesized (asset-free) buffers.
 *
 * The speed-wind loop (#399) and the thunder clap (#464) have no file in
 * public/sounds/: their samples come from speedWindBuffer.ts / thunderBuffer.ts,
 * rendered into an AudioBuffer once per manager on first use and cached.
 */

import { fillSpeedWindChannel, speedWindLoopLength } from './speedWindBuffer';
import { fillThunderChannel, thunderLength } from './thunderBuffer';

export interface SynthBuffers {
  /**
   * Distinct, synthesized speed-wind loop (#399 audio leftovers).
   *
   * The velocity bed used to reuse the `ambient_wind` asset, so it masked the
   * biome ambience it was layered over.
   */
  speedWindLoop(): AudioBuffer | null;
  /** Synthesized thunder clap (#464). */
  thunderClap(): AudioBuffer | null;
  /** Release the speed-wind loop (manager dispose). */
  release(): void;
}

export function createSynthBuffers(context: AudioContext | null): SynthBuffers {
  let speedWind: AudioBuffer | null = null;
  let thunder: AudioBuffer | null = null;

  return {
    speedWindLoop() {
      if (speedWind) return speedWind;
      if (!context) return null;

      const sampleRate = context.sampleRate;
      const length = speedWindLoopLength(sampleRate);
      const buffer = context.createBuffer(2, length, sampleRate);
      // Decorrelated channels — a mono wind bed collapses to the centre and
      // fights the positional water layers for the same image.
      fillSpeedWindChannel(buffer.getChannelData(0), 0x5eed);
      fillSpeedWindChannel(buffer.getChannelData(1), 0xb1a5);

      speedWind = buffer;
      return buffer;
    },

    thunderClap() {
      if (thunder) return thunder;
      if (!context) return null;
      const sampleRate = context.sampleRate;
      const buffer = context.createBuffer(2, thunderLength(sampleRate), sampleRate);
      fillThunderChannel(buffer.getChannelData(0), sampleRate, 0x7d0e);
      fillThunderChannel(buffer.getChannelData(1), sampleRate, 0x3a11);
      thunder = buffer;
      return buffer;
    },

    release() {
      speedWind = null;
    },
  };
}
