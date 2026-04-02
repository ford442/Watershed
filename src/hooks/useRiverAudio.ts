// src/hooks/useRiverAudio.ts
// Audio layer for Watershed — synced to flow speed, biome, and wave intensity

import { useRef, useEffect, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface RiverAudioOptions {
  /** Water whoosh sample ID from /api/samples */
  whooshSampleId?: string;
  /** Impact/thud sample ID for big waves */
  impactSampleId?: string;
  /** Music track IDs by biome from /api/music */
  musicIdsByBiome?: Record<string, string>;
  /** Master volume 0-1 */
  masterVolume?: number;
  /** Enable debug logging */
  debug?: boolean;
}

interface RiverAudioAPI {
  /** Manually trigger an impact sound */
  playImpact: () => void;
  /** Set master volume */
  setVolume: (vol: number) => void;
  /** Mute/unmute */
  setMuted: (muted: boolean) => void;
}

/**
 * useRiverAudio — Reactive audio system for the river
 * 
 * Features:
 * - Whoosh volume/pitch synced to flow speed
 * - Impact thuds on high wave intensity
 * - Biome-aware ambient music with cross-fade
 * - Fetches from FastAPI backend (/api/samples, /api/music)
 */
export const useRiverAudio = (
  shaderMaterialRef: React.MutableRefObject<THREE.ShaderMaterial | null>,
  currentBiome: string = 'river',
  options: RiverAudioOptions = {}
): RiverAudioAPI => {
  const {
    whooshSampleId = 'water-whoosh-001',
    impactSampleId = 'water-impact-001',
    musicIdsByBiome = {
      river: 'ambient-river-001',
      canyon: 'ambient-canyon-001',
      glacial: 'ambient-glacial-001',
      flume: 'ambient-flume-001',
      autumn: 'ambient-autumn-001',
    },
    masterVolume = 0.75,
    debug = false,
  } = options;

  // Audio element refs
  const whooshAudio = useRef<HTMLAudioElement | null>(null);
  const ambientAudio = useRef<HTMLAudioElement | null>(null);
  const impactPool = useRef<HTMLAudioElement[]>([]);
  const lastImpactTime = useRef(0);
  const lastAmbientBiome = useRef(currentBiome);
  const currentVolume = useRef(masterVolume);
  const isMuted = useRef(false);

  // Debug logger
  const log = useCallback((...args: any[]) => {
    if (debug) console.log('[useRiverAudio]', ...args);
  }, [debug]);

  // Initialize audio
  useEffect(() => {
    log('Initializing audio...');

    // Create whoosh audio (looped, flow-synced)
    whooshAudio.current = new Audio(`/api/samples/${whooshSampleId}`);
    whooshAudio.current.loop = true;
    whooshAudio.current.volume = 0;
    whooshAudio.current.preload = 'auto';

    // Create impact pool (3 overlapping instances)
    impactPool.current = Array.from({ length: 3 }, (_, i) => {
      const audio = new Audio(`/api/samples/${impactSampleId}`);
      audio.volume = masterVolume * 0.6;
      audio.preload = 'auto';
      return audio;
    });

    // Create ambient music
    const musicId = musicIdsByBiome[currentBiome] || musicIdsByBiome.river;
    ambientAudio.current = new Audio(`/api/music/${musicId}`);
    ambientAudio.current.loop = true;
    ambientAudio.current.volume = masterVolume * 0.35;
    ambientAudio.current.preload = 'auto';

    // Start playback (muted initially)
    Promise.all([
      whooshAudio.current.play().catch(e => log('Whoosh play failed:', e)),
      ambientAudio.current.play().catch(e => log('Ambient play failed:', e)),
    ]).then(() => {
      log('Audio started');
    });

    // Cleanup
    return () => {
      log('Cleaning up audio');
      whooshAudio.current?.pause();
      ambientAudio.current?.pause();
      impactPool.current.forEach(a => a.pause());
    };
  }, [whooshSampleId, impactSampleId, musicIdsByBiome, masterVolume, log]);

  // Cross-fade ambient when biome changes
  useEffect(() => {
    if (!ambientAudio.current || lastAmbientBiome.current === currentBiome) return;
    
    log('Biome change:', lastAmbientBiome.current, '->', currentBiome);
    lastAmbientBiome.current = currentBiome;

    const nextMusicId = musicIdsByBiome[currentBiome] || musicIdsByBiome.river;
    const targetVolume = isMuted.current ? 0 : currentVolume.current * 0.35;

    // Fade out current
    const fadeOut = setInterval(() => {
      if (!ambientAudio.current) {
        clearInterval(fadeOut);
        return;
      }
      
      ambientAudio.current.volume = Math.max(0, ambientAudio.current.volume - 0.05);
      
      if (ambientAudio.current.volume <= 0.05) {
        clearInterval(fadeOut);
        
        // Swap and fade in
        ambientAudio.current.src = `/api/music/${nextMusicId}`;
        ambientAudio.current.play().then(() => {
          const fadeIn = setInterval(() => {
            if (!ambientAudio.current) {
              clearInterval(fadeIn);
              return;
            }
            ambientAudio.current.volume = Math.min(
              targetVolume,
              ambientAudio.current.volume + 0.05
            );
            if (ambientAudio.current.volume >= targetVolume) {
              clearInterval(fadeIn);
              log('Ambient cross-fade complete');
            }
          }, 80);
        });
      }
    }, 50);

    return () => clearInterval(fadeOut);
  }, [currentBiome, musicIdsByBiome, log]);

  // Update volume when prop changes
  useEffect(() => {
    currentVolume.current = masterVolume;
    if (!isMuted.current) {
      if (ambientAudio.current) {
        ambientAudio.current.volume = masterVolume * 0.35;
      }
    }
  }, [masterVolume]);

  // Main flow-sync loop
  useFrame((state) => {
    const mat = shaderMaterialRef.current;
    if (!mat || !whooshAudio.current || isMuted.current) return;

    const time = state.clock.elapsedTime;
    const flowSpeed = mat.uniforms?.flowSpeed?.value ?? 1.2;

    // Sample flow field if available
    let intensity = flowSpeed / 2; // Base intensity on flow speed
    
    if (mat.userData?.waterFlowField) {
      try {
        const sample = mat.userData.waterFlowField.sampleAt(
          new THREE.Vector3(0, 0, 0),
          time
        );
        intensity = sample.speed;
      } catch (e) {
        // Fallback to uniform
      }
    }

    // Normalize intensity (typical range 0.5 - 2.5)
    const normalizedIntensity = Math.min(2.0, Math.max(0.2, intensity));

    // Update whoosh
    if (whooshAudio.current) {
      // Volume: quiet in calm water, loud in rapids
      const targetVolume = Math.min(1, normalizedIntensity * 0.6 * currentVolume.current);
      whooshAudio.current.volume = targetVolume;
      
      // Pitch: higher in fast water (0.85x - 1.5x)
      const targetRate = 0.85 + normalizedIntensity * 0.35;
      whooshAudio.current.playbackRate = Math.min(1.5, targetRate);
    }

    // Impact trigger on high intensity spikes
    // Only trigger if enough time has passed (debounce)
    const now = state.clock.elapsedTime * 1000;
    if (
      normalizedIntensity > 1.6 && 
      now - lastImpactTime.current > 400 && // 400ms cooldown
      Math.random() < 0.08 // 8% chance per frame
    ) {
      const impact = impactPool.current.find(a => a.paused || a.ended);
      if (impact) {
        impact.currentTime = 0;
        impact.volume = currentVolume.current * 0.8 * (normalizedIntensity / 2);
        impact.play().catch(() => {});
        lastImpactTime.current = now;
        log('Impact triggered, intensity:', normalizedIntensity.toFixed(2));
      }
    }
  });

  // Public API
  const playImpact = useCallback(() => {
    const impact = impactPool.current.find(a => a.paused || a.ended);
    if (impact) {
      impact.currentTime = 0;
      impact.volume = currentVolume.current * 0.7;
      impact.play().catch(() => {});
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    currentVolume.current = Math.max(0, Math.min(1, vol));
    if (!isMuted.current) {
      if (whooshAudio.current) whooshAudio.current.volume = 0;
      if (ambientAudio.current) {
        ambientAudio.current.volume = currentVolume.current * 0.35;
      }
    }
    log('Volume set to', currentVolume.current);
  }, [log]);

  const setMuted = useCallback((muted: boolean) => {
    isMuted.current = muted;
    if (muted) {
      if (whooshAudio.current) whooshAudio.current.volume = 0;
      if (ambientAudio.current) ambientAudio.current.volume = 0;
    } else {
      // Will restore on next frame
    }
    log(muted ? 'Muted' : 'Unmuted');
  }, [log]);

  return { playImpact, setVolume, setMuted };
};

export default useRiverAudio;
