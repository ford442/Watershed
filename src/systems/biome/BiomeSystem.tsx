/**
 * BiomeSystem — the biome's look: palette cross-fades, lighting / fog, and the
 * run's time of day. Visual only (#521 B): nothing here moves the player; the
 * flow cap, surface, cold and wind are the segment's GameplayProfile
 * (systems/gameplay/).
 *
 * State lives in a per-provider store, not in a context value:
 * - per-frame readers (lighting, fog, sky) read `useBiomeStore().getState()`
 *   inside useFrame and never re-render;
 * - components select a slice (`useBiomeSelector`, `useBiomeId`,
 *   `useBiomeTimeOfDay`) and re-render only when that slice changes;
 * - the setters have their own context (`useBiomeSetters`), stable for life.
 * - Time of day: the run's sky clock (systems/sky/skyClock.ts), as the daylight
 *   fraction (0 = sunrise, 0.5 = noon, 1 = sunset; outside [0, 1] at night)
 */

import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { BiomePalette, getBiomePalette, lerpBiomePalettes, applyBiomeToLighting } from '../../configs/BiomePalettes';
import { type BiomeId, DEFAULT_BIOME_ID } from '../../configs/biomes';
import { useGameStore } from '../GameState';
import { gameEvents } from '../events/GameEvents';
import { getSkyClock, getSkyPhase, subscribeSkyPhase } from '../sky/skyClock';

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
 * Transition progress commits to the store in steps of 1 / N, not once per
 * frame. Per-frame readers (lighting, fog) read the committed palette; a
 * component selecting a lerped field re-renders at most N times per fade.
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
 * The provider's store: the view plus the run's time of day. Per-frame readers
 * use `getState()` / `subscribe` (no re-render); components select a slice with
 * `useBiomeSelector` and re-render only when that slice changes.
 */
export type BiomeStore = StoreApi<BiomeStoreState>;

export interface BiomeStoreState extends BiomeView {
  /** Daylight fraction: 0 = sunrise, 0.5 = solar noon, 1 = sunset; below 0 / above 1 at night. */
  timeOfDay: number;
}

export interface BiomeSetters {
  setBiome: (biomeId: BiomeId, durationOverride?: number) => void;
  /** Instant biome snap — used on journey loop / respawn so delta/end palettes don't linger. */
  snapBiome: (biomeId: BiomeId) => void;
}

/**
 * The store, its cross-fade clock and the setters — one per provider, no React.
 * `advance(delta)` is the provider's per-frame step (exported for tests).
 */
export function createBiomeStore(initialBiome: BiomeId = DEFAULT_BIOME_ID, timeOfDay = FIXED_TIME_OF_DAY) {
  const initial = getBiomePalette(initialBiome);
  const store = createStore<BiomeStoreState>(() => ({ ...settledView(initial), timeOfDay }));
  const clock: BiomeTransitionClock = {
    from: initial,
    to: initial,
    elapsedSec: 0,
    durationSec: 0,
    active: false,
    step: BIOME_TRANSITION_STEPS,
  };

  // The store is the single source of truth for the biome's look; the
  // canonical palette id is mirrored to Zustand at once so HUD / audio /
  // weather consumers stay in sync. Gameplay reads its own profile (#521 B).
  const setBiome = (biomeId: BiomeId, durationOverride?: number) => {
    const newTarget = getBiomePalette(biomeId);
    if (newTarget.id === clock.to.id) return;

    // Cross-fade from wherever the last committed step left the palette.
    clock.from = store.getState().currentBiome;
    clock.to = newTarget;
    clock.elapsedSec = 0;
    clock.durationSec = durationOverride ?? newTarget.transitionDuration;
    clock.active = true;
    clock.step = 0;
    store.setState({
      currentBiome: clock.from,
      targetBiome: newTarget,
      transitionProgress: 0,
      isTransitioning: true,
    });
    useGameStore.setState({ currentBiome: newTarget.id });
  };

  const snapBiome = (biomeId: BiomeId) => {
    const palette = getBiomePalette(biomeId);
    clock.from = palette;
    clock.to = palette;
    clock.elapsedSec = 0;
    clock.durationSec = 0;
    clock.active = false;
    clock.step = BIOME_TRANSITION_STEPS;
    store.setState(settledView(palette));
    useGameStore.setState({ currentBiome: palette.id });
    gameEvents.emit('biome-change', {
      biome: palette.id,
      segmentIndex: useGameStore.getState().currentSegmentIndex,
    });
  };

  /** Advance the cross-fade on the frame delta: one store write per progress step. */
  const advance = (deltaSec: number) => {
    const next = advanceBiomeTransition(clock, deltaSec);
    if (next) store.setState(next);
  };

  const setters: BiomeSetters = { setBiome, snapBiome };
  return { store, setters, advance };
}

const BiomeStoreContext = createContext<BiomeStore | null>(null);
const BiomeSettersContext = createContext<BiomeSetters | null>(null);

/**
 * The provider's store, for per-frame readers: `getState()` inside useFrame,
 * or `subscribe` into a ref. Reading it does not re-render.
 */
export function useBiomeStore(): BiomeStore {
  const store = useContext(BiomeStoreContext);
  if (!store) throw new Error('Biome hooks must be used within BiomeProvider');
  return store;
}

/** A slice of the biome view; re-renders only when the slice changes (by `Object.is`). */
export function useBiomeSelector<T>(selector: (state: BiomeStoreState) => T): T {
  return useStore(useBiomeStore(), selector);
}

const selectTimeOfDay = (s: BiomeStoreState) => s.timeOfDay;
const selectBiomeId = (s: BiomeStoreState) => s.currentBiome.id;

/** The run's time of day (changes about every 5 game minutes). */
export const useBiomeTimeOfDay = () => useBiomeSelector(selectTimeOfDay);

/** The current palette's id: changes once or twice per cross-fade, never per step. */
export const useBiomeId = () => useBiomeSelector(selectBiomeId);

/** `setBiome` / `snapBiome`: stable for the provider's life, never re-render. */
export function useBiomeSetters(): BiomeSetters {
  const setters = useContext(BiomeSettersContext);
  if (!setters) throw new Error('useBiomeSetters must be used within BiomeProvider');
  return setters;
}

/**
 * BiomeProvider — the biome's look (palette cross-fade, time of day) for the
 * scene. Visual only (#521 B): gameplay reads the segment's GameplayProfile.
 *
 * Both contexts carry identities that never change, so the provider re-renders
 * nothing; a transition is store writes that only selecting components hear.
 */
export const BiomeProvider: React.FC<BiomeProviderProps> = ({
  children,
  initialBiome = DEFAULT_BIOME_ID,
  enableTimeOfDay = false,
}) => {
  const [biome] = useState(() =>
    createBiomeStore(initialBiome, enableTimeOfDay ? getSkyPhase().timeOfDay : FIXED_TIME_OF_DAY),
  );

  // Sync initial biome id to Zustand store so all consumers start in agreement.
  useEffect(() => {
    useGameStore.setState({ currentBiome: getBiomePalette(initialBiome).id });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Advance the cross-fade on sim time: one store write per progress step.
  useFrame((_, delta) => biome.advance(delta));

  // Time of day: the sky clock's coarse phase (~every 5 game minutes); per-frame
  // readers use getSkyClock().
  useEffect(() => {
    if (!enableTimeOfDay) {
      biome.store.setState({ timeOfDay: FIXED_TIME_OF_DAY });
      return undefined;
    }
    biome.store.setState({ timeOfDay: getSkyPhase().timeOfDay });
    return subscribeSkyPhase((phase) => biome.store.setState({ timeOfDay: phase.timeOfDay }));
  }, [biome, enableTimeOfDay]);

  return (
    <BiomeSettersContext.Provider value={biome.setters}>
      <BiomeStoreContext.Provider value={biome.store}>{children}</BiomeStoreContext.Provider>
    </BiomeSettersContext.Provider>
  );
};

/**
 * BiomeTransition - Component that applies biome to scene elements
 */
export const BiomeTransition: React.FC = () => {
  const biomeStore = useBiomeStore();
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
    const { currentBiome } = biomeStore.getState();

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
