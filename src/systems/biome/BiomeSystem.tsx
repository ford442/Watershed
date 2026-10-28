/**
 * BiomeSystem - the biome's *look*: palette cross-fades and environmental storytelling.
 *
 * Visual only (#521 B). Nothing here pushes the player: the flow cap, grip and
 * cold are the segment's `GameplayProfile` (systems/map/gameplayProfile.ts).
 *
 * Handles:
 * - Biome state management
 * - Smooth color/parameter interpolation between biomes
 * - Integration with lighting, fog, water, and materials
 * - Time of day: the run's sky clock (systems/sky/skyClock.ts), as the daylight
 *   fraction (0 = sunrise, 0.5 = noon, 1 = sunset; outside [0, 1] at night)
 *
 * Who reads what, so a cross-fade costs React nothing it does not need:
 * - the **store** (`useBiomeStore()`): the cross-fading palette, committed once
 *   per progress step. Per-frame readers `getView()` inside their own
 *   `useFrame`, or `subscribe` for a transient callback. No re-render.
 * - the **memoised context** (`useBiome()`): changes only when something a
 *   render can see changes — the target biome, transitioning vs settled, the
 *   coarse time of day. `currentBiome` on it is one stable object kept live
 *   (updated in place each step), so a `useFrame` closure over it always reads
 *   the current palette. A 2 s cross-fade re-renders its consumers twice.
 * - the **setters** (`useBiomeActions()`): their own context, never changes.
 * - `useBiomeView()` / `useBiomeMaterials()`: opt in to a re-render per step.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { BiomePalette, getBiomePalette, lerpBiomePalettes, applyBiomeToLighting } from '../../configs/BiomePalettes';
import { type BiomeId, DEFAULT_BIOME_ID, normalizeBiomeId } from '../../configs/biomes';
import { useGameStore } from '../GameState';
import { gameEvents } from '../events/GameEvents';
import { getSkyClock, getSkyPhase, subscribeSkyPhase } from '../sky/skyClock';

// What a render can see (changes rarely — see the header).
type BiomeContextType = {
  /** One stable palette object, updated in place every committed step. */
  currentBiome: BiomePalette;
  targetBiome: BiomePalette;
  /** Live: reads the store at access time, so reading it never needs a re-render. */
  readonly transitionProgress: number;
  isTransitioning: boolean;
  /** Daylight fraction: 0 = sunrise, 0.5 = solar noon, 1 = sunset; below 0 / above 1 at night. */
  timeOfDay: number;
  setBiome: (biomeId: BiomeId, durationOverride?: number) => void;
  /** Instant biome snap — used on journey loop / respawn so delta/end palettes don't linger. */
  snapBiome: (biomeId: BiomeId) => void;
};

type BiomeActions = Pick<BiomeContextType, 'setBiome' | 'snapBiome'>;

/** The cross-fade as of the last committed step. */
export interface BiomeView {
  currentBiome: BiomePalette;
  targetBiome: BiomePalette;
  transitionProgress: number;
  isTransitioning: boolean;
}

/**
 * The transient side of the biome: the last committed view and a subscribe for
 * per-frame readers. Created once per BiomeProvider.
 */
export interface BiomeStore {
  getView(): BiomeView;
  /** The stable palette object `useBiome().currentBiome` returns, current as of `getView()`. */
  getLivePalette(): BiomePalette;
  /** Called after every commit (a progress step, a start, a settle, a snap). Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

interface BiomeStoreInternal extends BiomeStore {
  commit(view: BiomeView, options?: { start?: boolean }): void;
}

function settledView(palette: BiomePalette): BiomeView {
  return { currentBiome: palette, targetBiome: palette, transitionProgress: 1, isTransitioning: false };
}

function createBiomeStore(initial: BiomeView): BiomeStoreInternal {
  let view = initial;
  // A private copy: the palette tables are shared config and must never be mutated.
  const live: BiomePalette = { ...initial.currentBiome };
  const listeners = new Set<() => void>();
  return {
    getView: () => view,
    getLivePalette: () => live,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    commit(next, options) {
      view = next;
      Object.assign(live, next.currentBiome);
      // A fade reads as the target biome from its first frame (the palette lerp's own id).
      if (options?.start) live.id = next.targetBiome.id;
      for (const listener of [...listeners]) listener();
    },
  };
}

const BiomeContext = createContext<BiomeContextType | null>(null);
const BiomeActionsContext = createContext<BiomeActions | null>(null);
const BiomeStoreContext = createContext<BiomeStore | null>(null);

export const useBiome = () => {
  const context = useContext(BiomeContext);
  if (!context) throw new Error('useBiome must be used within BiomeProvider');
  return context;
};

/** The setters (`setBiome`, `snapBiome`) — a context that never changes, so using it never re-renders. */
export const useBiomeActions = (): BiomeActions => {
  const context = useContext(BiomeActionsContext);
  if (!context) throw new Error('useBiomeActions must be used within BiomeProvider');
  return context;
};

/** The transient store, for `useFrame` / `subscribe` readers. Never changes. */
export const useBiomeStore = (): BiomeStore => {
  const store = useContext(BiomeStoreContext);
  if (!store) throw new Error('useBiomeStore must be used within BiomeProvider');
  return store;
};

/** The cross-fade, re-rendering the caller once per committed step. Prefer the store for per-frame work. */
export const useBiomeView = (): BiomeView => {
  const store = useBiomeStore();
  return useSyncExternalStore(store.subscribe, store.getView, store.getView);
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
 * Transition progress commits to the biome store in steps of 1 / N, not once
 * per frame; only `useBiomeView` / `useBiomeMaterials` callers re-render per
 * step. Per-frame readers (lighting, fog) read the committed palette.
 */
export const BIOME_TRANSITION_STEPS = 48;

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
  const [store] = useState(() => createBiomeStore(settledView(getBiomePalette(initialBiome))));
  // What a render can see of the cross-fade: the target and whether it is still running.
  // Per-step progress is committed to the store only.
  const [phase, setPhase] = useState(() => {
    const view = store.getView();
    return { targetBiome: view.targetBiome, isTransitioning: view.isTransitioning };
  });
  const [timeOfDay, setTimeOfDay] = useState(() => (enableTimeOfDay ? getSkyPhase().timeOfDay : FIXED_TIME_OF_DAY));

  const clockRef = useRef<BiomeTransitionClock>({
    from: store.getView().currentBiome,
    to: store.getView().targetBiome,
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
  // BiomeProvider is the single source of truth for the biome's *look*; after
  // updating the internal transition target we immediately mirror the canonical
  // palette id to the Zustand store so HUD / lighting / survival consumers stay
  // in sync. (The water's flow cap is not among them: that is the segment's
  // GameplayProfile.) The cross-fade itself runs on the frame delta (sim time)
  // in useFrame below.
  const setBiome = useCallback((biomeId: BiomeId, durationOverride?: number) => {
    const newTarget = getBiomePalette(biomeId);
    const clock = clockRef.current;
    if (newTarget.id === clock.to.id) return;

    // Cross-fade from wherever the last committed step left the palette.
    clock.from = { ...store.getLivePalette() };
    clock.to = newTarget;
    clock.elapsedSec = 0;
    clock.durationSec = durationOverride ?? newTarget.transitionDuration;
    clock.active = true;
    clock.step = 0;
    store.commit(
      {
        currentBiome: clock.from,
        targetBiome: newTarget,
        transitionProgress: 0,
        isTransitioning: true,
      },
      { start: true },
    );
    setPhase({ targetBiome: newTarget, isTransitioning: true });

    // Mirror canonical biome id to Zustand store (single point of write).
    useGameStore.setState({ currentBiome: newTarget.id });
  }, [store]);

  const snapBiome = useCallback((biomeId: BiomeId) => {
    const palette = getBiomePalette(biomeId);
    const clock = clockRef.current;
    clock.from = palette;
    clock.to = palette;
    clock.elapsedSec = 0;
    clock.durationSec = 0;
    clock.active = false;
    clock.step = BIOME_TRANSITION_STEPS;
    store.commit(settledView(palette));
    setPhase({ targetBiome: palette, isTransitioning: false });
    useGameStore.setState({ currentBiome: palette.id });
    gameEvents.emit('biome-change', {
      biome: palette.id,
      segmentIndex: useGameStore.getState().currentSegmentIndex,
    });
  }, [store]);

  // Advance the cross-fade on sim time: one store commit per progress step,
  // one React update when it settles.
  useFrame((_, delta) => {
    const next = advanceBiomeTransition(clockRef.current, delta);
    if (!next) return;
    store.commit(next);
    if (!next.isTransitioning) setPhase({ targetBiome: next.targetBiome, isTransitioning: false });
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

  const actions = useMemo<BiomeActions>(() => ({ setBiome, snapBiome }), [setBiome, snapBiome]);

  const value = useMemo<BiomeContextType>(
    () => ({
      currentBiome: store.getLivePalette(),
      targetBiome: phase.targetBiome,
      get transitionProgress() {
        return store.getView().transitionProgress;
      },
      isTransitioning: phase.isTransitioning,
      timeOfDay,
      setBiome,
      snapBiome,
    }),
    [store, phase, timeOfDay, setBiome, snapBiome],
  );

  return (
    <BiomeStoreContext.Provider value={store}>
      <BiomeActionsContext.Provider value={actions}>
        <BiomeContext.Provider value={value}>{children}</BiomeContext.Provider>
      </BiomeActionsContext.Provider>
    </BiomeStoreContext.Provider>
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
    // Transient read: the cross-fade's current palette, with no re-render.
    const { currentBiome } = biomeStore.getView();

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
  const { setBiome } = useBiomeActions();
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
 * UseBiomeMaterials hook - Get material configurations from the cross-fading biome
 * (re-renders its caller once per committed step; the water *force* does not read it)
 */
export function useBiomeMaterials() {
  const { currentBiome } = useBiomeView();
  
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
