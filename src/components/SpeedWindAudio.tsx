/**
 * SpeedWindAudio.tsx
 *
 * Continuous speed-based wind bed for the feel-of-velocity, plus the
 * close-water gurgle.
 * - Prefers the AudioWorklet voice (systems/audio/speedWindDsp.ts): synthesis,
 *   gain curve, wetness muffle and wall-tightness colour all run on the audio
 *   thread; this component only forwards raw parameters when they move.
 * - Falls back to the synthesized 4 s buffer loop + BiquadFilter (#399) when
 *   `audioWorklet.addModule` is unavailable or fails.
 * - Never the `ambient_wind` asset — the velocity bed must not mask the biome
 *   ambience it sits on.
 * - Final level = windGain * maxVolume * SFX * wetnessMuffle * master, on
 *   either path (see speedWindVoice.ts).
 *
 * Mounted by ReactiveAudio (reach path) and InnerExperience (default TrackManager).
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { getAudioManager } from '../systems/audio/AudioSystem';
import { mapCloseGurgle } from '../systems/audio/speedWind';
import { createSpeedWindVoice, type SpeedWindInput, type SpeedWindVoice } from '../systems/audio/speedWindVoice';
import { getSfxWetnessMultiplier } from '../systems/audio/wetnessMuffle';

interface SpeedWindAudioProps {
  /** Vehicle rigid body ref — same speed source as ReactiveAudio whoosh ducking. */
  targetRef: React.RefObject<any>;
  enabled?: boolean;
}

export default function SpeedWindAudio({
  targetRef,
  enabled = true,
}: SpeedWindAudioProps) {
  const voiceRef = useRef<SpeedWindVoice | null>(null);
  const flowRef = useRef({ flowSpeed: 1, turbulence: 0 });
  // Reused every frame — no per-frame allocation in useFrame.
  const inputRef = useRef<SpeedWindInput>({ speed: 0, sfxVolume: 1, wetness: 1, wallTightness: 0, gurgle: 0 });

  useEffect(() => {
    if (!enabled) return;

    const am = getAudioManager();
    if (!am) {
      console.warn('[SpeedWindAudio] AudioManager not initialized.');
      return;
    }

    // Synthesized rather than loaded, on either path: no decode round-trip and
    // nothing gated behind the unlock gesture's fetches.
    let cancelled = false;
    createSpeedWindVoice({
      listener: am.getListener(),
      getFallbackBuffer: () => am.getSpeedWindBuffer(),
    }).then((voice) => {
      if (!voice) return;
      if (cancelled) {
        voice.dispose();
        return;
      }
      voiceRef.current = voice;
    });

    return () => {
      cancelled = true;
      voiceRef.current?.dispose();
      voiceRef.current = null;
    };
  }, [enabled]);

  // Fade with end-of-run / wipeout audio reset (vehicle is also zeroed → stays silent).
  useEffect(() => {
    const onRunReset = () => {
      voiceRef.current?.reset();
      flowRef.current = { flowSpeed: 1, turbulence: 0 };
    };
    const onFlow = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      flowRef.current = {
        flowSpeed: Number.isFinite(detail.flowSpeed) ? detail.flowSpeed : 1,
        turbulence: Number.isFinite(detail.turbulence) ? detail.turbulence : 0,
      };
    };
    window.addEventListener('watershed-run-reset', onRunReset);
    window.addEventListener('water-flow-update', onFlow);
    return () => {
      window.removeEventListener('watershed-run-reset', onRunReset);
      window.removeEventListener('water-flow-update', onFlow);
    };
  }, []);

  useFrame((_, delta) => {
    const voice = voiceRef.current;
    if (!enabled || !voice || !targetRef?.current) return;
    if (!Number.isFinite(delta) || delta <= 0) return;

    const body = targetRef.current;
    if (typeof body.linvel !== 'function') return;

    const vel = body.linvel();
    const velX = Number.isFinite(vel?.x) ? vel.x : 0;
    const velZ = Number.isFinite(vel?.z) ? vel.z : 0;
    const playerSpeed = Math.sqrt(velX * velX + velZ * velZ);

    const am = getAudioManager();
    const input = inputRef.current;
    input.speed = playerSpeed;
    // Raw SFX channel: the voice applies the wetness duck itself (in-worklet
    // or via wetnessMuffleParams), so getEffectiveSfxGain would double it.
    input.sfxVolume = am?.getSfxVolume() ?? 1;
    input.wetness = getSfxWetnessMultiplier();
    input.wallTightness = am?.getCanyonWallTightness() ?? 0;
    input.gurgle = mapCloseGurgle(playerSpeed, flowRef.current.flowSpeed, flowRef.current.turbulence);

    const windGain = voice.update(input, delta);
    am?.setReactiveVolumes({ wind: windGain });
  });

  return null;
}
