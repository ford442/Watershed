/**
 * ReactiveAudio.tsx
 *
 * Real-time reactive audio layer for Watershed.
 * - Ambient music crossfades between low/medium/high intensity based on flowSpeed + player velocity
 * - SFX loop scales rapids roar with current strength
 * - Positional audio for transition segments (waterfall roar)
 * - Splash one-shots triggered by speed + turbulence
 *
 * Uses Three.js native Audio / PositionalAudio with buffers from AssetCache.audioBuffers
 * and falls back to AudioManager SOUND_LIBRARY for local dev.
 */

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getAudioManager } from '../systems/AudioSystem';
import { AssetCache } from '../systems/ReachStreamer';
import { REACH_API_BASE } from '../constants/game';
import { AUDIO_CONFIG } from '../constants/audioConfig';
import { useGameStore } from '../systems/GameState';
import { useLOD } from '../systems/LODManager';
import { PILLAR_BREAK_EVENT } from '../components/Obstacles/pillarBreakEvents';
import { isGlacialBiome } from '../configs/TrackBiomes';
import type { ReachManifest } from '../systems/ReachStreamer';
import type { NormalizedSegment } from '../systems/ReachNormalizer';

interface ReactiveAudioProps {
  /** Vehicle rigid body ref */
  targetRef: React.RefObject<any>;
  /** Reach identifier (for AssetCache lookup) */
  reachId?: string;
  /** Reach manifest (for transition segment info) */
  manifest?: ReachManifest;
  /** Normalized segments (for transition segment position) */
  reachSegments?: NormalizedSegment[];
}

function resolveAudioBuffer(
  reachId: string | undefined,
  assetId: string,
  fallbackName: string
): AudioBuffer | null {
  // 1. Try Reach-specific preloaded buffer from AssetCache
  if (reachId) {
    const manifest = AssetCache.reaches.get(reachId);
    const asset = manifest?.requiredAssets?.audio?.find((a) => a.id === assetId);
    if (asset) {
      const fullUrl =
        asset.url.startsWith('http://') ||
        asset.url.startsWith('https://') ||
        asset.url.startsWith('/')
          ? asset.url
          : `${REACH_API_BASE}/${reachId}/assets/${asset.url}`;
      const buf = AssetCache.audioBuffers.get(fullUrl);
      if (buf) return buf;
    }
  }

  // 2. Fallback to AudioManager default library
  const am = getAudioManager();
  if (am) {
    const buf = am.getBuffer(fallbackName);
    if (buf) return buf;
  }

  return null;
}

export default function ReactiveAudio({
  targetRef,
  reachId,
  manifest,
  reachSegments,
}: ReactiveAudioProps) {
  const { scene } = useThree();

  // Ambient layer refs
  const ambientLowRef = useRef<THREE.Audio | null>(null);
  const ambientMidRef = useRef<THREE.Audio | null>(null);
  const ambientHighRef = useRef<THREE.Audio | null>(null);

  // SFX layer refs
  const sfxRapidsRef = useRef<THREE.Audio | null>(null);
  const sfxWhooshRef = useRef<THREE.Audio | null>(null);
  const sfxColdWindRef = useRef<THREE.Audio | null>(null);
  const sfxIceCrackRef = useRef<THREE.Audio | null>(null);
  const posTransitionRef = useRef<THREE.PositionalAudio | null>(null);

  // Lerped volume targets
  const volumesRef = useRef({
    low: 0,
    mid: 0,
    high: 0,
    rapids: 0,
    whoosh: 0,
    transition: 0,
    coldWind: 0,
    iceCrack: 0,
  });

  const flowRef = useRef({
    flowSpeed: 1,
    turbulence: 0,
    state: 'Normal',
  });

  const splashCooldownRef = useRef(0);
  const [audioReady, setAudioReady] = useState(false);
  const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
  const currentBiomeId = useGameStore((s) => s.currentBiome);
  const { quality } = useLOD();

  // ========================================================================
  // Initialize audio nodes
  // ========================================================================
  useEffect(() => {
    const am = getAudioManager();
    if (!am) {
      console.warn('[ReactiveAudio] AudioManager not initialized. Call initAudio(camera) first.');
      return;
    }
    const listener = am.getListener();

    const setup = async () => {
      // Preload fallback sounds if needed
      const fallbackNames = [
        AUDIO_CONFIG.defaultAmbientTracks.low,
        AUDIO_CONFIG.defaultAmbientTracks.mid,
        AUDIO_CONFIG.defaultAmbientTracks.high,
        AUDIO_CONFIG.defaultSfxTracks.rapids,
        AUDIO_CONFIG.defaultSfxTracks.whoosh,
        AUDIO_CONFIG.defaultSfxTracks.splash,
        AUDIO_CONFIG.defaultSfxTracks.coldWind,
        AUDIO_CONFIG.defaultSfxTracks.iceCrack,
      ];
      await Promise.all(fallbackNames.map((n) => am.loadSound(n)));

      const lowBuf = resolveAudioBuffer(reachId, 'ambient_low', AUDIO_CONFIG.defaultAmbientTracks.low);
      const midBuf = resolveAudioBuffer(reachId, 'ambient_mid', AUDIO_CONFIG.defaultAmbientTracks.mid);
      const highBuf = resolveAudioBuffer(reachId, 'ambient_high', AUDIO_CONFIG.defaultAmbientTracks.high);
      const rapidsBuf = resolveAudioBuffer(reachId, 'sfx_rapids', AUDIO_CONFIG.defaultSfxTracks.rapids);
      const whooshBuf = resolveAudioBuffer(reachId, 'sfx_whoosh', AUDIO_CONFIG.defaultSfxTracks.whoosh);
      const coldWindBuf = resolveAudioBuffer(reachId, 'sfx_cold_wind', AUDIO_CONFIG.defaultSfxTracks.coldWind);
      const iceCrackBuf = resolveAudioBuffer(reachId, 'sfx_ice_crack', AUDIO_CONFIG.defaultSfxTracks.iceCrack);

      if (lowBuf) {
        ambientLowRef.current = new THREE.Audio(listener);
        ambientLowRef.current.setBuffer(lowBuf);
        ambientLowRef.current.setLoop(true);
        ambientLowRef.current.setVolume(0);
        ambientLowRef.current.play();
      }
      if (midBuf) {
        ambientMidRef.current = new THREE.Audio(listener);
        ambientMidRef.current.setBuffer(midBuf);
        ambientMidRef.current.setLoop(true);
        ambientMidRef.current.setVolume(0);
        ambientMidRef.current.play();
      }
      if (highBuf) {
        ambientHighRef.current = new THREE.Audio(listener);
        ambientHighRef.current.setBuffer(highBuf);
        ambientHighRef.current.setLoop(true);
        ambientHighRef.current.setVolume(0);
        ambientHighRef.current.play();
      }
      if (rapidsBuf) {
        sfxRapidsRef.current = new THREE.Audio(listener);
        sfxRapidsRef.current.setBuffer(rapidsBuf);
        sfxRapidsRef.current.setLoop(true);
        sfxRapidsRef.current.setVolume(0);
        sfxRapidsRef.current.play();
      }
      if (whooshBuf) {
        sfxWhooshRef.current = new THREE.Audio(listener);
        sfxWhooshRef.current.setBuffer(whooshBuf);
        sfxWhooshRef.current.setLoop(true);
        sfxWhooshRef.current.setVolume(0);
        sfxWhooshRef.current.play();
      }
      if (coldWindBuf) {
        sfxColdWindRef.current = new THREE.Audio(listener);
        sfxColdWindRef.current.setBuffer(coldWindBuf);
        sfxColdWindRef.current.setLoop(true);
        sfxColdWindRef.current.setVolume(0);
        sfxColdWindRef.current.play();
      }
      if (iceCrackBuf) {
        sfxIceCrackRef.current = new THREE.Audio(listener);
        sfxIceCrackRef.current.setBuffer(iceCrackBuf);
        sfxIceCrackRef.current.setLoop(true);
        sfxIceCrackRef.current.setVolume(0);
        sfxIceCrackRef.current.setPlaybackRate(0.85);
        sfxIceCrackRef.current.play();
      }

      // Positional transition audio (waterfall / slot canyon roar)
      if (manifest && reachSegments) {
        const tIdx = manifest.transition.segmentIndex;
        const tSeg = reachSegments[tIdx];
        if (tSeg?.segmentPath) {
          const center = tSeg.segmentPath.getPoint(0.5);
          const tBuf = resolveAudioBuffer(reachId, 'sfx_transition', AUDIO_CONFIG.defaultSfxTracks.transition);
          if (tBuf && isFinite(center.x) && isFinite(center.y) && isFinite(center.z)) {
            posTransitionRef.current = new THREE.PositionalAudio(listener);
            posTransitionRef.current.setBuffer(tBuf);
            posTransitionRef.current.setLoop(true);
            posTransitionRef.current.setRefDistance(AUDIO_CONFIG.positional.transitionRefDistance);
            posTransitionRef.current.setRolloffFactor(AUDIO_CONFIG.positional.transitionRolloff);
            posTransitionRef.current.setVolume(0);
            posTransitionRef.current.position.copy(center);
            posTransitionRef.current.play();
            scene.add(posTransitionRef.current);
          }
        }
      }

      setAudioReady(true);
    };

    setup();

    return () => {
      [ambientLowRef, ambientMidRef, ambientHighRef, sfxRapidsRef, sfxWhooshRef, sfxColdWindRef, sfxIceCrackRef].forEach((ref) => {
        if (ref.current) {
          ref.current.stop();
          ref.current.disconnect();
          ref.current = null;
        }
      });
      if (posTransitionRef.current) {
        posTransitionRef.current.stop();
        posTransitionRef.current.disconnect();
        scene.remove(posTransitionRef.current);
        posTransitionRef.current = null;
      }
      const mgr = getAudioManager();
      mgr?.disableCanyonAcoustics();
      setAudioReady(false);
    };
  }, [reachId, manifest, reachSegments, scene]);

  // Canyon acoustics toggle + filter routing
  useEffect(() => {
    if (!audioReady) return;
    const am = getAudioManager();
    if (!am) return;

    const isSlotCanyon = currentSegmentIndex >= 20 && currentSegmentIndex <= 22;
    if (isSlotCanyon) {
      am.enableCanyonAcoustics(0.78);
    } else {
      am.disableCanyonAcoustics();
    }

    [ambientLowRef, ambientMidRef, ambientHighRef, sfxRapidsRef, sfxWhooshRef, posTransitionRef].forEach((ref) => {
      if (ref.current) am.applyCanyonFilters(ref.current);
    });
  }, [audioReady, currentSegmentIndex]);

  // ========================================================================
  // Listen to global flow events
  // ========================================================================
  useEffect(() => {
    const onFlow = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        flowRef.current = {
          flowSpeed: detail.flowSpeed ?? 1,
          turbulence: detail.turbulence ?? 0,
          state: detail.state ?? 'Normal',
        };
      }
    };
    const onRunReset = () => {
      flowRef.current = { flowSpeed: 1, turbulence: 0, state: 'Normal' };
      volumesRef.current = { low: 0, mid: 0, high: 0, rapids: 0, whoosh: 0, transition: 0, coldWind: 0, iceCrack: 0 };
      splashCooldownRef.current = 0;
    };
    const onPillarBreak = () => {
      // Brief biome duck so the demolition rumble reads over ambient stems.
      volumesRef.current.low *= 0.45;
      volumesRef.current.mid *= 0.55;
      volumesRef.current.high *= 0.65;
      volumesRef.current.transition = Math.max(volumesRef.current.transition, 0.9);
    };
    window.addEventListener('water-flow-update', onFlow);
    window.addEventListener('watershed-run-reset', onRunReset);
    window.addEventListener(PILLAR_BREAK_EVENT, onPillarBreak);
    return () => {
      window.removeEventListener('water-flow-update', onFlow);
      window.removeEventListener('watershed-run-reset', onRunReset);
      window.removeEventListener(PILLAR_BREAK_EVENT, onPillarBreak);
    };
  }, []);

  // ========================================================================
  // Per-frame volume mixing and splash triggers
  // ========================================================================
  useFrame((_, delta) => {
    if (!audioReady || !targetRef?.current) return;

    // Guard against non-finite delta values (first frame, tab background/foreground)
    if (!isFinite(delta) || delta <= 0) return;

    const body = targetRef.current;
    const vel = body.linvel();
    const velX = isFinite(vel.x) ? vel.x : 0;
    const velZ = isFinite(vel.z) ? vel.z : 0;
    const playerSpeed = Math.sqrt(velX * velX + velZ * velZ);
    const rawFlowSpeed = flowRef.current.flowSpeed;
    const flowSpeed = isFinite(rawFlowSpeed) ? rawFlowSpeed : 1;
    const turbulence = isFinite(flowRef.current.turbulence) ? flowRef.current.turbulence : 0;

    // Compute overall intensity 0-1
    const rawIntensity =
      flowSpeed * AUDIO_CONFIG.intensity.flowSpeedWeight +
      playerSpeed * AUDIO_CONFIG.intensity.playerSpeedWeight;
    const intensity = Math.min(AUDIO_CONFIG.intensity.maxIntensity, rawIntensity);

    // Crossfade targets for ambient layers
    // Low dominates at 0, fades by ~0.4
    const targetLow = Math.max(0, 1 - intensity * 2.8);
    // Mid peaks around 0.35
    const targetMid = Math.max(0, 1 - Math.abs(intensity - 0.35) * 3.5);
    // High fades in above 0.5
    const targetHigh = quality === 'low'
      ? 0
      : Math.min(1, Math.max(0, (intensity - 0.25) * 1.6));
    // Rapids sfx rises quadratically
    const targetRapids = Math.min(1, intensity * intensity * 1.6);
    const whooshSpan = Math.max(1, AUDIO_CONFIG.sfx.whooshFullSpeed - AUDIO_CONFIG.sfx.whooshStartSpeed);
    const targetWhoosh = quality === 'low'
      ? 0
      : THREE.MathUtils.clamp((playerSpeed - AUDIO_CONFIG.sfx.whooshStartSpeed) / whooshSpan, 0, 1);

    const inGlacialBiome = isGlacialBiome(currentBiomeId);
    const targetColdWind = inGlacialBiome ? AUDIO_CONFIG.glacial.coldWindVolume : 0;
    const targetIceCrack = inGlacialBiome
      ? AUDIO_CONFIG.glacial.iceCrackVolume * (0.35 + turbulence * 0.65)
      : 0;

    // Smooth interpolation
    const lerp = AUDIO_CONFIG.ambient.crossfadeSpeed * delta;
    // Guard lerp against non-finite values
    if (!isFinite(lerp) || lerp < 0) return;

    const v = volumesRef.current;
    
    // Update volume states
    v.low += (targetLow - v.low) * lerp;
    v.mid += (targetMid - v.mid) * lerp;
    v.high += (targetHigh - v.high) * lerp;
    v.rapids += (targetRapids - v.rapids) * lerp;
    v.whoosh += (targetWhoosh - v.whoosh) * lerp;
    v.coldWind += (targetColdWind - v.coldWind) * AUDIO_CONFIG.glacial.crossfadeSpeed * delta;
    v.iceCrack += (targetIceCrack - v.iceCrack) * AUDIO_CONFIG.glacial.crossfadeSpeed * delta;

    // Harden: reset any NaN values back to 0
    if (!isFinite(v.low)) v.low = 0;
    if (!isFinite(v.mid)) v.mid = 0;
    if (!isFinite(v.high)) v.high = 0;
    if (!isFinite(v.rapids)) v.rapids = 0;
    if (!isFinite(v.whoosh)) v.whoosh = 0;
    if (!isFinite(v.coldWind)) v.coldWind = 0;
    if (!isFinite(v.iceCrack)) v.iceCrack = 0;

    // Channel multipliers from the settings panel, layered on TOP of the ducking
    // above (never an override). `AUDIO_CONFIG.masterVolume` remains the baseline
    // mix constant; the store channels scale it. Read transiently from the
    // AudioManager singleton so slider drags don't re-render this subtree.
    const amMix = getAudioManager();
    const music = AUDIO_CONFIG.masterVolume * (amMix?.getMusicVolume() ?? 1);
    const sfx = AUDIO_CONFIG.masterVolume * (amMix?.getSfxVolume() ?? 1);

    // Set ambient layer volumes with guards
    if (ambientLowRef.current) {
      const lowVol = v.low * AUDIO_CONFIG.ambient.lowVolume * music;
      if (isFinite(lowVol)) {
        ambientLowRef.current.setVolume(lowVol);
      }
    }
    if (ambientMidRef.current) {
      const midVol = v.mid * AUDIO_CONFIG.ambient.midVolume * music;
      if (isFinite(midVol)) {
        ambientMidRef.current.setVolume(midVol);
      }
    }
    if (ambientHighRef.current) {
      const highVol = v.high * AUDIO_CONFIG.ambient.highVolume * music;
      if (isFinite(highVol)) {
        ambientHighRef.current.setVolume(highVol);
      }
    }
    if (sfxRapidsRef.current) {
      const rapidsVol =
        v.rapids *
        THREE.MathUtils.lerp(AUDIO_CONFIG.sfx.rapidsBaseVolume, AUDIO_CONFIG.sfx.rapidsMaxVolume, intensity);
      if (isFinite(rapidsVol)) {
        sfxRapidsRef.current.setVolume(rapidsVol * sfx);
      }
    }
    if (sfxWhooshRef.current) {
      const whooshVol = v.whoosh * AUDIO_CONFIG.sfx.whooshMaxVolume * sfx;
      if (isFinite(whooshVol)) {
        sfxWhooshRef.current.setVolume(whooshVol);
      }
    }
    if (sfxColdWindRef.current) {
      const windVol = v.coldWind * sfx;
      if (isFinite(windVol)) {
        sfxColdWindRef.current.setVolume(windVol);
      }
    }
    if (sfxIceCrackRef.current) {
      const crackVol = v.iceCrack * sfx;
      if (isFinite(crackVol)) {
        sfxIceCrackRef.current.setVolume(crackVol);
      }
    }

    // Positional transition volume based on distance
    if (posTransitionRef.current) {
      const playerPos = new THREE.Vector3().copy(body.translation());
      const distance = playerPos.distanceTo(posTransitionRef.current.position);
      const fade =
        1 -
        Math.min(
          1,
          distance / AUDIO_CONFIG.positional.transitionFadeDistance
        );
      const phaseBoost =
        currentSegmentIndex === 13 ? 0.75 :
        currentSegmentIndex === 14 ? 1.0 :
        currentSegmentIndex >= 15 ? 0.5 : 0.25;
      const targetTransition = fade * AUDIO_CONFIG.positional.transitionMaxVolume * phaseBoost;
      v.transition += (targetTransition - v.transition) * lerp;
      
      // Harden: reset any NaN values back to 0
      if (!isFinite(v.transition)) v.transition = 0;
      
      const transitionVol = v.transition * sfx;
      if (isFinite(transitionVol)) {
        posTransitionRef.current.setVolume(transitionVol);
      }
    }

    const am = getAudioManager();
    am?.setReactiveVolumes({
      low: v.low,
      mid: v.mid,
      high: v.high,
      rapids: v.rapids,
      whoosh: v.whoosh,
      transition: v.transition,
    });

    // Splash one-shots
    if (splashCooldownRef.current > 0) {
      splashCooldownRef.current -= delta;
    }
    if (
      splashCooldownRef.current <= 0 &&
      playerSpeed > AUDIO_CONFIG.sfx.splashThresholdSpeed &&
      turbulence > AUDIO_CONFIG.sfx.splashThresholdTurbulence
    ) {
      const dynamicCooldown = Math.max(0.08, 0.4 - playerSpeed * 0.015);
      splashCooldownRef.current = Math.min(AUDIO_CONFIG.sfx.splashCooldown, dynamicCooldown);
      if (am) {
        const dynamicPitch = THREE.MathUtils.clamp(0.8 + playerSpeed * 0.02, 0.8, 1.8);
        const dynamicVolume = THREE.MathUtils.clamp(playerSpeed * 0.04, 0.15, 1.0);
        am.playSound(
          AUDIO_CONFIG.defaultSfxTracks.splash,
          AUDIO_CONFIG.sfx.splashVolume * dynamicVolume,
          dynamicPitch
        );
      }
    }
  });

  return null;
}
