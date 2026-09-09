/**
 * SpeedWindAudio.tsx
 *
 * Continuous speed-based wind bed for the feel-of-velocity.
 * - Loops a synthesized wind buffer of its own (#399). It used to reuse
 *   `ambient_wind`, so the velocity bed masked the biome ambience it sat on.
 * - Gain scales with vehicle horizontal speed (linvel), lerped to avoid zipper
 * - Optional BiquadFilter lowpass brightens with speed
 * - Final volume = windGain * maxVolume * SFX * wetnessMuffle * master
 *
 * Mounted by ReactiveAudio (reach path) and InnerExperience (default TrackManager).
 */

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getAudioManager } from '../systems/audio/AudioSystem';
import { AUDIO_CONFIG } from '../constants/audioConfig';
import {
  mapSpeedToWind,
  sanitizeAudioGain,
  sanitizeCutoffHz,
} from '../systems/audio/speedWind';

interface SpeedWindAudioProps {
  /** Vehicle rigid body ref — same speed source as ReactiveAudio whoosh ducking. */
  targetRef: React.RefObject<any>;
  enabled?: boolean;
}

export default function SpeedWindAudio({
  targetRef,
  enabled = true,
}: SpeedWindAudioProps) {
  const windRef = useRef<THREE.Audio | null>(null);
  const lowpassRef = useRef<BiquadFilterNode | null>(null);
  const gainRef = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const am = getAudioManager();
    if (!am) {
      console.warn('[SpeedWindAudio] AudioManager not initialized.');
      return;
    }

    // Synthesized rather than loaded: the wind bed needs to be a different
    // signal from the ambience, not a second voice of it. No await, so the bed
    // is live on the first frame instead of after a decode round-trip.
    const buf = am.getSpeedWindBuffer();
    if (buf) {
      const listener = am.getListener();
      const wind = new THREE.Audio(listener);
      wind.setBuffer(buf);
      wind.setLoop(true);
      wind.setVolume(0);
      wind.play();

      // Dedicated lowpass — brighter as speed rises. Owned here so canyon
      // acoustics on other ReactiveAudio layers never overwrite it.
      const ctx = listener.context;
      if (ctx) {
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = AUDIO_CONFIG.wind.cutoffAtRest;
        lowpass.Q.value = 0.7;
        wind.setFilters([lowpass]);
        lowpassRef.current = lowpass;
      }

      windRef.current = wind;
      setReady(true);
    }

    return () => {
      if (windRef.current) {
        windRef.current.stop();
        windRef.current.setFilters([]);
        windRef.current.disconnect();
        windRef.current = null;
      }
      lowpassRef.current = null;
      setReady(false);
    };
  }, [enabled]);

  // Fade with end-of-run / wipeout audio reset (vehicle is also zeroed → stays silent).
  useEffect(() => {
    const onRunReset = () => {
      gainRef.current = 0;
      if (windRef.current) {
        windRef.current.setVolume(0);
      }
      if (lowpassRef.current) {
        lowpassRef.current.frequency.value = AUDIO_CONFIG.wind.cutoffAtRest;
      }
    };
    window.addEventListener('watershed-run-reset', onRunReset);
    return () => window.removeEventListener('watershed-run-reset', onRunReset);
  }, []);

  useFrame((_, delta) => {
    if (!enabled || !ready || !windRef.current || !targetRef?.current) return;
    if (!Number.isFinite(delta) || delta <= 0) return;

    const body = targetRef.current;
    if (typeof body.linvel !== 'function') return;

    const vel = body.linvel();
    const velX = Number.isFinite(vel?.x) ? vel.x : 0;
    const velZ = Number.isFinite(vel?.z) ? vel.z : 0;
    const playerSpeed = Math.sqrt(velX * velX + velZ * velZ);

    const mapped = mapSpeedToWind(playerSpeed, {
      startSpeed: AUDIO_CONFIG.wind.startSpeed,
      fullSpeed: AUDIO_CONFIG.wind.fullSpeed,
      cutoffAtRest: AUDIO_CONFIG.wind.cutoffAtRest,
      cutoffAtFull: AUDIO_CONFIG.wind.cutoffAtFull,
    });

    const lerp = AUDIO_CONFIG.wind.crossfadeSpeed * delta;
    if (!Number.isFinite(lerp) || lerp < 0) return;

    gainRef.current += (mapped.gain - gainRef.current) * Math.min(1, lerp);
    if (!Number.isFinite(gainRef.current)) gainRef.current = 0;

    // Settings SFX × wetness muffle × master baseline — same layering as the
    // ReactiveAudio SFX beds.
    const am = getAudioManager();
    const sfxMult =
      AUDIO_CONFIG.masterVolume * (am?.getEffectiveSfxGain() ?? 1);
    const windVol = sanitizeAudioGain(
      gainRef.current * AUDIO_CONFIG.wind.maxVolume * sfxMult,
    );

    if (Number.isFinite(windVol)) {
      windRef.current.setVolume(windVol);
    }

    if (lowpassRef.current) {
      const cutoff = sanitizeCutoffHz(
        mapped.cutoffHz,
        AUDIO_CONFIG.wind.cutoffAtRest,
      );
      // Smooth cutoff slightly so filter moves don't click.
      const current = lowpassRef.current.frequency.value;
      const next = current + (cutoff - current) * Math.min(1, lerp);
      if (Number.isFinite(next)) {
        lowpassRef.current.frequency.value = next;
      }
    }

    am?.setReactiveVolumes({ wind: gainRef.current });
  });

  return null;
}
