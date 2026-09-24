/**
 * speedWindVoice.ts — one speed-wind bed, on whichever path the context allows.
 *
 * Preferred: the AudioWorklet (speedWindDsp.ts) — continuous, non-repeating,
 * with the close-water gurgle, and parameters applied on the audio thread.
 * Fallback: the pre-baked 4 s loop (speedWindBuffer.ts) through a BiquadFilter,
 * exactly the path that shipped before the worklet.
 *
 * Both paths honour the same mix contract as the ReactiveAudio SFX beds:
 *
 *   volume = speedGain · wind.maxVolume · masterVolume · sfxVolume · wetnessGain
 *
 * On the worklet path `speedGain` and `wetnessGain` are applied inside the
 * processor, so the carrying THREE.Audio only takes the constant part.
 */

import * as THREE from 'three';
import { AUDIO_CONFIG } from '../../constants/audioConfig';
import { mapSpeedToWind, sanitizeAudioGain, sanitizeCutoffHz } from './speedWind';
import type { SpeedWindDspOptions } from './speedWindDsp';
import { createSpeedWindNode, loadSpeedWindWorklet, type SpeedWindNodeParams } from './speedWindWorklet';
import { wetnessMuffleParams } from './wetnessMuffle';

export interface SpeedWindInput {
  /** Horizontal speed (m/s). */
  speed: number;
  /** Raw settings SFX channel 0–1 (not the wetness-scaled effective gain). */
  sfxVolume: number;
  /** `sfxWetnessMultiplier` (1 dry … 0.65 soaked). */
  wetness: number;
  /** Canyon wall tightness 0–1; 0 when acoustics are off. */
  wallTightness: number;
  /** Close-water grain amount 0–1 (worklet only). */
  gurgle: number;
}

export interface SpeedWindVoice {
  readonly kind: 'worklet' | 'buffer';
  readonly audio: THREE.Audio;
  /** Advance one render frame; returns the smoothed speed gain 0–1 (diagnostics). */
  update(input: SpeedWindInput, delta: number): number;
  /** Run reset: drop to silence immediately. */
  reset(): void;
  dispose(): void;
}

export interface SpeedWindVoiceDeps {
  listener: THREE.AudioListener;
  /** Synthesized fallback loop (AudioManager.getSpeedWindBuffer). */
  getFallbackBuffer: () => AudioBuffer | null;
  /** Override for tests; defaults to the real module loader. */
  loadWorklet?: (ctx: BaseAudioContext) => Promise<boolean>;
}

const WIND = AUDIO_CONFIG.wind;

const DSP_OPTIONS: SpeedWindDspOptions = {
  startSpeed: WIND.startSpeed,
  fullSpeed: WIND.fullSpeed,
  cutoffAtRest: WIND.cutoffAtRest,
  cutoffAtFull: WIND.cutoffAtFull,
  crossfadeSpeed: WIND.crossfadeSpeed,
  gurgleLevel: WIND.gurgleLevel,
};

function mapWind(speed: number) {
  return mapSpeedToWind(speed, DSP_OPTIONS);
}

/** Main-thread mirror of the speed gain smoothing, for diagnostics and the fallback. */
class GainFollower {
  value = 0;
  step(target: number, delta: number): number {
    const lerp = WIND.crossfadeSpeed * delta;
    if (!Number.isFinite(lerp) || lerp < 0) return this.value;
    this.value += (target - this.value) * Math.min(1, lerp);
    if (!Number.isFinite(this.value)) this.value = 0;
    return this.value;
  }
}

/** Write an AudioParam only when it moved — no per-frame automation churn. */
function writeParam(param: AudioParam, value: number, epsilon: number): void {
  if (Number.isFinite(value) && Math.abs(param.value - value) > epsilon) param.value = value;
}

function workletVoice(
  listener: THREE.AudioListener,
  node: AudioWorkletNode,
  params: SpeedWindNodeParams,
): SpeedWindVoice {
  const audio = new THREE.Audio(listener);
  audio.setNodeSource(node);
  audio.setVolume(0);
  const follower = new GainFollower();
  let lastVolume = -1;

  return {
    kind: 'worklet',
    audio,
    update(input, delta) {
      writeParam(params.speed, input.speed, 0.01);
      writeParam(params.wetness, input.wetness, 1e-3);
      writeParam(params.wallTightness, input.wallTightness, 1e-3);
      writeParam(params.gurgle, input.gurgle, 1e-3);

      const volume = sanitizeAudioGain(WIND.maxVolume * AUDIO_CONFIG.masterVolume * input.sfxVolume);
      if (Math.abs(volume - lastVolume) > 1e-3) {
        audio.setVolume(volume);
        lastVolume = volume;
      }
      return follower.step(mapWind(input.speed).gain, delta);
    },
    reset() {
      follower.value = 0;
      params.speed.value = 0;
      node.port.postMessage({ type: 'reset' });
    },
    dispose() {
      node.port.postMessage({ type: 'dispose' });
      audio.disconnect();
      node.disconnect();
    },
  };
}

function bufferVoice(listener: THREE.AudioListener, buffer: AudioBuffer): SpeedWindVoice {
  const audio = new THREE.Audio(listener);
  audio.setBuffer(buffer);
  audio.setLoop(true);
  audio.setVolume(0);
  audio.play();

  // Dedicated lowpass — brighter as speed rises. Owned here so canyon
  // acoustics on other layers never overwrite it.
  const lowpass = listener.context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = WIND.cutoffAtRest;
  lowpass.Q.value = 0.7;
  audio.setFilters([lowpass]);

  const follower = new GainFollower();

  return {
    kind: 'buffer',
    audio,
    update(input, delta) {
      const mapped = mapWind(input.speed);
      const gain = follower.step(mapped.gain, delta);
      const muffle = wetnessMuffleParams(input.wetness);

      const volume = sanitizeAudioGain(
        gain * WIND.maxVolume * AUDIO_CONFIG.masterVolume * input.sfxVolume * muffle.gain,
      );
      audio.setVolume(volume);

      // Speed brightens, wetness darkens — whichever is lower wins.
      const cutoff = sanitizeCutoffHz(Math.min(mapped.cutoffHz, muffle.cutoffHz), WIND.cutoffAtRest);
      const lerp = Math.min(1, WIND.crossfadeSpeed * delta);
      const current = lowpass.frequency.value;
      const next = current + (cutoff - current) * (Number.isFinite(lerp) ? lerp : 0);
      if (Number.isFinite(next)) lowpass.frequency.value = next;

      return gain;
    },
    reset() {
      follower.value = 0;
      audio.setVolume(0);
      lowpass.frequency.value = WIND.cutoffAtRest;
    },
    dispose() {
      audio.stop();
      audio.setFilters([]);
      audio.disconnect();
    },
  };
}

/**
 * Build the voice: worklet when the context can load it, else the buffer loop.
 * Resolves null only when neither is possible (no buffer could be made).
 */
export async function createSpeedWindVoice(deps: SpeedWindVoiceDeps): Promise<SpeedWindVoice | null> {
  const ctx = deps.listener.context;
  const load = deps.loadWorklet ?? loadSpeedWindWorklet;

  if (ctx && (await load(ctx))) {
    const created = createSpeedWindNode(ctx, DSP_OPTIONS);
    if (created) return workletVoice(deps.listener, created.node, created.params);
  }

  const buffer = deps.getFallbackBuffer();
  return buffer ? bufferVoice(deps.listener, buffer) : null;
}
