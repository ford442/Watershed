/**
 * BiomeSystem - Manages biome transitions and environmental storytelling
 * 
 * Handles:
 * - Biome state management
 * - Smooth color/parameter interpolation between biomes
 * - Integration with lighting, fog, water, and materials
 * - Time-of-day progression
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { BiomePalette, getBiomePalette, lerpBiomePalettes, applyBiomeToLighting } from '../configs/BiomePalettes';
import { type BiomeId, DEFAULT_BIOME_ID, normalizeBiomeId } from '../configs/biomes';
import { useGameStore } from './GameState';

// Context for biome state
type BiomeContextType = {
  currentBiome: BiomePalette;
  targetBiome: BiomePalette;
  transitionProgress: number;
  isTransitioning: boolean;
  timeOfDay: number; // 0-1 (0=8am, 0.5=noon, 1=5pm)
  setBiome: (biomeId: BiomeId, durationOverride?: number) => void;
  /** Instant biome snap — used on journey loop / respawn so delta/end palettes don't linger. */
  snapBiome: (biomeId: BiomeId) => void;
  setTimeOfDay: (time: number) => void;
};

const BiomeContext = createContext<BiomeContextType | null>(null);

export const useBiome = () => {
  const context = useContext(BiomeContext);
  if (!context) throw new Error('useBiome must be used within BiomeProvider');
  return context;
};

// Props for the provider
interface BiomeProviderProps {
  children: React.ReactNode;
  initialBiome?: BiomeId;
  enableTimeOfDay?: boolean;
  timeOfDaySpeed?: number; // hours per second
}

/**
 * BiomeProvider - Context provider for biome management
 */
export const BiomeProvider: React.FC<BiomeProviderProps> = ({
  children,
  initialBiome = DEFAULT_BIOME_ID,
  enableTimeOfDay = false,
  timeOfDaySpeed = 0.1, // 0.1 game hours per real second
}) => {
  const [currentBiome, setCurrentBiomeState] = useState(() => getBiomePalette(initialBiome));
  const [targetBiome, setTargetBiome] = useState(() => getBiomePalette(initialBiome));
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionProgress, setTransitionProgress] = useState(1);
  const [timeOfDay, setTimeOfDay] = useState(0.25); // Start at 10am
  
  const transitionStartTime = useRef(0);
  const previousBiome = useRef(currentBiome);

  // Sync initial biome id to Zustand store so all consumers start in agreement.
  useEffect(() => {
    useGameStore.setState({ currentBiome: getBiomePalette(initialBiome).id });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Start biome transition.
  // BiomeProvider is the single source of truth for biome state; after updating
  // the internal transition target we immediately mirror the canonical palette id
  // to the Zustand store so HUD / lighting consumers stay in sync.
  const setBiome = useCallback((biomeId: BiomeId, durationOverride?: number) => {
    const newTarget = getBiomePalette(biomeId);
    if (newTarget.id === targetBiome.id) return;
    
    previousBiome.current = currentBiome;
    setTargetBiome(newTarget);
    setIsTransitioning(true);
    setTransitionProgress(0);
    transitionStartTime.current = performance.now();

    // Mirror canonical biome id to Zustand store (single point of write).
    useGameStore.setState({ currentBiome: newTarget.id });
    
    // Store duration override on the target for the transition effect to read
    if (durationOverride !== undefined) {
      (newTarget as any).__durationOverride = durationOverride;
    }
  }, [currentBiome, targetBiome]);

  const snapBiome = useCallback((biomeId: BiomeId) => {
    const palette = getBiomePalette(biomeId);
    previousBiome.current = palette;
    setCurrentBiomeState(palette);
    setTargetBiome(palette);
    setIsTransitioning(false);
    setTransitionProgress(1);
    delete (palette as any).__durationOverride;
    useGameStore.setState({ currentBiome: palette.id });
    window.dispatchEvent(
      new CustomEvent('biome-change', {
        detail: { biome: palette.id, segmentIndex: useGameStore.getState().currentSegmentIndex },
      })
    );
  }, []);
  
  // Update transition progress
  useEffect(() => {
    if (!isTransitioning) return;
    
    const durationOverride = (targetBiome as any).__durationOverride;
    const duration = (durationOverride !== undefined ? durationOverride : targetBiome.transitionDuration) * 1000;
    
    const updateTransition = () => {
      const elapsed = performance.now() - transitionStartTime.current;
      const progress = Math.min(1, elapsed / duration);
      
      setTransitionProgress(progress);
      
      // Interpolate current biome
      const interpolated = lerpBiomePalettes(
        previousBiome.current,
        targetBiome,
        progress
      );
      setCurrentBiomeState(interpolated);
      
      if (progress < 1) {
        requestAnimationFrame(updateTransition);
      } else {
        setIsTransitioning(false);
        previousBiome.current = targetBiome;
      }
    };
    
    const raf = requestAnimationFrame(updateTransition);
    return () => cancelAnimationFrame(raf);
  }, [isTransitioning, targetBiome]);
  
  // Time of day progression
  useEffect(() => {
    if (!enableTimeOfDay) return;
    
    const interval = setInterval(() => {
      setTimeOfDay(t => (t + timeOfDaySpeed / 3600) % 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [enableTimeOfDay, timeOfDaySpeed]);
  
  return (
    <BiomeContext.Provider value={{
      currentBiome,
      targetBiome,
      transitionProgress,
      isTransitioning,
      timeOfDay,
      setBiome,
      snapBiome,
      setTimeOfDay,
    }}>
      {children}
    </BiomeContext.Provider>
  );
};

/**
 * BiomeTransition - Component that applies biome to scene elements
 */
export const BiomeTransition: React.FC = () => {
  const { currentBiome, timeOfDay } = useBiome();
  const { scene } = useThree();
  const [weatherType, setWeatherType] = useState('clear');

  useEffect(() => {
    const onWeatherUpdate = (event: Event) => {
      const incoming = (event as CustomEvent)?.detail?.type;
      if (typeof incoming === 'string') setWeatherType(incoming);
    };
    const onRunReset = () => setWeatherType('clear');
    window.addEventListener('weather-update', onWeatherUpdate);
    window.addEventListener('watershed-run-reset', onRunReset);
    return () => {
      window.removeEventListener('weather-update', onWeatherUpdate);
      window.removeEventListener('watershed-run-reset', onRunReset);
    };
  }, []);

  // Get lighting references
  const lightsRef = useRef<{
    ambient?: THREE.AmbientLight;
    hemi?: THREE.HemisphereLight;
    sun?: THREE.DirectionalLight;
    fill?: THREE.DirectionalLight;
  }>({});
  
  // Find lights in scene
  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.AmbientLight) lightsRef.current.ambient = obj;
      if (obj instanceof THREE.HemisphereLight) lightsRef.current.hemi = obj;
      if (obj instanceof THREE.DirectionalLight) {
        // Assume first is sun, second is fill
        if (!lightsRef.current.sun) lightsRef.current.sun = obj;
        else if (!lightsRef.current.fill) lightsRef.current.fill = obj;
      }
    });
  }, [scene]);
  
  // Update sun position based on time of day
  // 0 = 8am (sunrise), 0.5 = noon, 1 = 5pm (sunset)
  const getSunPosition = (time: number): [number, number, number] => {
    // Sun arc: rises in east (-30°), peaks at noon (90°), sets in west (30°)
    const angle = (time - 0.5) * Math.PI; // -PI/2 to PI/2
    const height = Math.cos(angle * 0.8) * 40 + 15; // Arc height
    const x = Math.sin(angle) * 60;
    const z = Math.cos(angle) * 30 + 10;
    return [x, height, z];
  };
  
  // Apply biome updates every frame
  useFrame(() => {
    const { ambient, hemi, sun, fill } = lightsRef.current;
    if (!ambient || !hemi || !sun || !fill) return;

    // Update sun position
    const sunPos = getSunPosition(timeOfDay);
    sun.position.set(...sunPos);

    // Sun elevation (0 = horizon/below, 1 = directly overhead) drives the
    // warm/cool color temperature shift and intensity falloff.
    const sunElevation = THREE.MathUtils.clamp(sunPos[1] / 40, 0, 1);
    const isSlotCanyon = currentBiome.id === 'slotCanyon';

    // Apply palette to lighting, with weather + time-of-day modulation
    applyBiomeToLighting(currentBiome, { ambient, hemi, sun, fill }, {
      isSlotCanyon,
      weatherType,
      sunElevation,
    });
    
    // Update fog
    if (scene.fog && !scene.userData.skyOwnsFog) {
      scene.fog.color.set(currentBiome.fogColor);
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = currentBiome.fogNear;
        scene.fog.far = currentBiome.fogFar;
      }
    }
    
    // Update background (sky)
    if (scene.background) {
      if (scene.background instanceof THREE.Color) {
        scene.background.set(currentBiome.skyColor);
      }
    }
  });
  
  return null;
};

/**
 * BiomeDetector - Detects when player enters different biome segments
 */
interface BiomeDetectorProps {
  onBiomeChange?: (biomeId: BiomeId) => void;
  segmentBiomes?: Record<number, BiomeId | string>;
}

export const BiomeDetector: React.FC<BiomeDetectorProps> = ({
  onBiomeChange,
  segmentBiomes = {},
}) => {
  const { camera } = useThree();
  const { setBiome } = useBiome();
  const lastBiomeRef = useRef<string>('');
  
  useFrame(() => {
    // Simple detection: use camera Z position to determine segment
    const camZ = camera.position.z;
    const segmentLength = 40; // Approximate
    const segmentIndex = Math.floor(Math.abs(camZ) / segmentLength);
    
    const raw = segmentBiomes[segmentIndex];
    if (raw && raw !== lastBiomeRef.current) {
      const biomeId = normalizeBiomeId(raw);
      lastBiomeRef.current = biomeId;
      setBiome(biomeId);
      onBiomeChange?.(biomeId);
    }
  });
  
  return null;
};

/**
 * UseBiomeMaterials hook - Get material configurations from current biome
 */
export function useBiomeMaterials() {
  const { currentBiome } = useBiome();
  
  return {
    water: {
      baseColor: currentBiome.waterColor,
      deepColor: currentBiome.waterDeepColor,
      foamColor: currentBiome.foamColor,
      causticsIntensity: currentBiome.causticsIntensity,
      opacity: currentBiome.waterOpacity,
      flowSpeed: currentBiome.flowSpeed,
    },
    canyon: {
      rockBaseColor: currentBiome.rockBaseColor,
      rockMossColor: currentBiome.rockMossColor,
      weatheringIntensity: currentBiome.weatheringIntensity,
    },
    vegetation: {
      color: currentBiome.vegetationColor,
      density: currentBiome.vegetationDensity,
    },
    effects: {
      fireflyCount: currentBiome.fireflyCount,
      mistDensity: currentBiome.mistDensity,
      sunShaftIntensity: currentBiome.sunShaftIntensity,
      fallingLeaves: currentBiome.fallingLeaves,
    },
  };
}
