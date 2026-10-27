/**
 * BiomeSystem - Manages biome transitions and environmental storytelling
 * 
 * Handles:
 * - Biome state management
 * - Smooth color/parameter interpolation between biomes
 * - Integration with lighting, fog, water, and materials
 * - Time of day: the run's sky clock (systems/sky/skyClock.ts), as the daylight
 *   fraction (0 = sunrise, 0.5 = noon, 1 = sunset; outside [0, 1] at night)
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { BiomePalette, getBiomePalette, lerpBiomePalettes, applyBiomeToLighting } from '../../configs/BiomePalettes';
import { type BiomeId, DEFAULT_BIOME_ID, normalizeBiomeId } from '../../configs/biomes';
import { useGameStore } from '../GameState';
import { gameEvents } from '../events/GameEvents';
import { getSkyClock, getSkyPhase, subscribeSkyPhase } from '../sky/skyClock';

// Context for biome state
type BiomeContextType = {
  currentBiome: BiomePalette;
  targetBiome: BiomePalette;
  transitionProgress: number;
  isTransitioning: boolean;
  /** Daylight fraction: 0 = sunrise, 0.5 = solar noon, 1 = sunset; below 0 / above 1 at night. */
  timeOfDay: number;
  setBiome: (biomeId: BiomeId, durationOverride?: number) => void;
  /** Instant biome snap — used on journey loop / respawn so delta/end palettes don't linger. */
  snapBiome: (biomeId: BiomeId) => void;
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
  /**
   * Follow the run's sky clock (launch hour + sim time). Off = the old fixed
   * mid-morning (0.25), for harnesses that want a frozen sky.
   */
  enableTimeOfDay?: boolean;
}

/** The fixed mid-morning `timeOfDay` when the clock is off. */
const FIXED_TIME_OF_DAY = 0.25;

/**
 * Transition progress commits to React state in steps of 1 / N: consumers
 * re-render N times per cross-fade, not once per frame. Per-frame readers
 * (lighting, fog) read the committed palette.
 */
export const BIOME_TRANSITION_STEPS = 48;

interface BiomeView {
  currentBiome: BiomePalette;
  targetBiome: BiomePalette;
  transitionProgress: number;
  isTransitioning: boolean;
}

interface BiomeTransitionClock {
  from: BiomePalette;
  to: BiomePalette;
  /** Sim seconds into the cross-fade (advanced by the frame delta). */
  elapsedSec: number;
  durationSec: number;
  active: boolean;
  /** Last committed step, 0..BIOME_TRANSITION_STEPS. */
  step: number;
}

function settledView(palette: BiomePalette): BiomeView {
  return { currentBiome: palette, targetBiome: palette, transitionProgress: 1, isTransitioning: false };
}

/**
 * Advance a cross-fade by `deltaSec` of sim time. Returns the view to commit
 * when the progress crossed into a new step, else null. Pure on the clock
 * object (mutated in place), so it is unit-testable without a Canvas.
 */
export function advanceBiomeTransition(clock: BiomeTransitionClock, deltaSec: number): BiomeView | null {
  if (!clock.active) return null;
  clock.elapsedSec += Math.max(0, deltaSec);
  const progress = clock.durationSec > 0 ? Math.min(1, clock.elapsedSec / clock.durationSec) : 1;
  const step = progress >= 1 ? BIOME_TRANSITION_STEPS : Math.floor(progress * BIOME_TRANSITION_STEPS);
  if (step === clock.step) return null;
  clock.step = step;
  if (step >= BIOME_TRANSITION_STEPS) {
    clock.active = false;
    clock.from = clock.to;
    return settledView(clock.to);
  }
  const stepProgress = step / BIOME_TRANSITION_STEPS;
  return {
    currentBiome: lerpBiomePalettes(clock.from, clock.to, stepProgress),
    targetBiome: clock.to,
    transitionProgress: stepProgress,
    isTransitioning: true,
  };
}

/**
 * BiomeProvider - Context provider for biome management
 */
export const BiomeProvider: React.FC<BiomeProviderProps> = ({
  children,
  initialBiome = DEFAULT_BIOME_ID,
  enableTimeOfDay = false,
}) => {
  const [view, setView] = useState<BiomeView>(() => settledView(getBiomePalette(initialBiome)));
  const [timeOfDay, setTimeOfDay] = useState(() => (enableTimeOfDay ? getSkyPhase().timeOfDay : FIXED_TIME_OF_DAY));

  // The live view, mirrored for the stable callbacks below.
  const viewRef = useRef(view);
  viewRef.current = view;
  const clockRef = useRef<BiomeTransitionClock>({
    from: view.currentBiome,
    to: view.targetBiome,
    elapsedSec: 0,
    durationSec: 0,
    active: false,
    step: BIOME_TRANSITION_STEPS,
  });

  // Sync initial biome id to Zustand store so all consumers start in agreement.
  useEffect(() => {
    useGameStore.setState({ currentBiome: getBiomePalette(initialBiome).id });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start biome transition.
  // BiomeProvider is the single source of truth for biome state; after updating
  // the internal transition target we immediately mirror the canonical palette id
  // to the Zustand store so HUD / lighting / survival consumers stay in sync.
  // The cross-fade itself runs on the frame delta (sim time) in useFrame below.
  const setBiome = useCallback((biomeId: BiomeId, durationOverride?: number) => {
    const newTarget = getBiomePalette(biomeId);
    const clock = clockRef.current;
    if (newTarget.id === clock.to.id) return;

    // Cross-fade from wherever the last committed step left the palette.
    clock.from = viewRef.current.currentBiome;
    clock.to = newTarget;
    clock.elapsedSec = 0;
    clock.durationSec = durationOverride ?? newTarget.transitionDuration;
    clock.active = true;
    clock.step = 0;
    const next: BiomeView = {
      currentBiome: clock.from,
      targetBiome: newTarget,
      transitionProgress: 0,
      isTransitioning: true,
    };
    viewRef.current = next;
    setView(next);

    // Mirror canonical biome id to Zustand store (single point of write).
    useGameStore.setState({ currentBiome: newTarget.id });
  }, []);

  const snapBiome = useCallback((biomeId: BiomeId) => {
    const palette = getBiomePalette(biomeId);
    const clock = clockRef.current;
    clock.from = palette;
    clock.to = palette;
    clock.elapsedSec = 0;
    clock.durationSec = 0;
    clock.active = false;
    clock.step = BIOME_TRANSITION_STEPS;
    const next = settledView(palette);
    viewRef.current = next;
    setView(next);
    useGameStore.setState({ currentBiome: palette.id });
    gameEvents.emit('biome-change', {
      biome: palette.id,
      segmentIndex: useGameStore.getState().currentSegmentIndex,
    });
  }, []);

  // Advance the cross-fade on sim time: one state commit per progress step.
  useFrame((_, delta) => {
    const next = advanceBiomeTransition(clockRef.current, delta);
    if (!next) return;
    viewRef.current = next;
    setView(next);
  });

  // Time of day: the sky clock's coarse phase (~every 5 game minutes), so the
  // context re-renders its consumers rarely; per-frame readers use getSkyClock().
  useEffect(() => {
    if (!enableTimeOfDay) {
      setTimeOfDay(FIXED_TIME_OF_DAY);
      return undefined;
    }
    setTimeOfDay(getSkyPhase().timeOfDay);
    return subscribeSkyPhase((phase) => setTimeOfDay(phase.timeOfDay));
  }, [enableTimeOfDay]);

  const value = useMemo<BiomeContextType>(
    () => ({ ...view, timeOfDay, setBiome, snapBiome }),
    [view, timeOfDay, setBiome, snapBiome],
  );

  return <BiomeContext.Provider value={value}>{children}</BiomeContext.Provider>;
};

/**
 * BiomeTransition - Component that applies biome to scene elements
 */
export const BiomeTransition: React.FC = () => {
  const { currentBiome } = useBiome();
  const { scene } = useThree();
  const weatherType = useGameStore((s) => s.weather.type);

  // Get lighting references
  const lightsRef = useRef<{
    ambient?: THREE.AmbientLight;
    hemi?: THREE.HemisphereLight;
    sun?: THREE.DirectionalLight;
    fill?: THREE.DirectionalLight;
  }>({});
  
  // Find lights in scene. The key light is the one SceneLighting tags
  // (`userData.keyLight`); the other directional is the fill. SceneLighting,
  // not this component, places the key light (it follows the sky clock's sun).
  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.AmbientLight) lightsRef.current.ambient = obj;
      if (obj instanceof THREE.HemisphereLight) lightsRef.current.hemi = obj;
      if (obj instanceof THREE.DirectionalLight) {
        if (obj.userData.keyLight === true) lightsRef.current.sun = obj;
        else if (!lightsRef.current.fill) lightsRef.current.fill = obj;
      }
    });
  }, [scene]);

  // Apply biome updates every frame
  useFrame(() => {
    const { ambient, hemi, sun, fill } = lightsRef.current;
    if (!ambient || !hemi || !sun || !fill) return;

    // Sun elevation (0 = horizon/below, 1 = well up) drives the warm/cool
    // colour-temperature shift and intensity falloff.
    const sunElevation = getSkyClock().factors.elevation01;
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
