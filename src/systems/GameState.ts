/**
 * GameState.ts — Global game state managed by Zustand
 *
 * RESPONSIBILITIES:
 * - Centralize player state (position, speed, biome, distance, segment)
 * - Pause / wipeout / respawn state
 * - Settings (graphics quality, sound volume)
 * - Provide frame-throttled batch updates to avoid excessive re-renders
 *
 * DESIGN:
 * - Uses Zustand for fine-grained subscriptions (components only re-render when
 *   the slices they select change).
 * - Player position is stored as a plain {x,y,z} object — NOT a THREE.Vector3 —
 *   so the store remains serializable and works with Zustand devtools.
 * - High-frequency updates (position every frame) are throttled in the caller
 *   (Experience.jsx) rather than inside the store.
 */

import { create } from 'zustand';

// =============================================================================
// TYPES
// =============================================================================

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface GameSettings {
  quality: QualityPreset;
  soundVolume: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

export interface GameState {
  playerPosition: { x: number; y: number; z: number };
  currentSpeed: number;
  currentBiome: string;
  isPaused: boolean;
  distanceTraveled: number;
  distance: number;
  score: number;
  multiplier: number;
  topSpeed: number;
  comboLabel: string;
  highScore: number;
  currentSegmentIndex: number;
  isWipeout: boolean;
  isJourneyComplete: boolean;
  isDodging: boolean;
  respawnSegmentIndex: number;
  waterfallGravityMultiplier: number;
  /** Spawn points indexed by segment id */
  spawnPoints: Record<number, SpawnPoint>;
  settings: GameSettings;
  /** Sprint stamina for the runner (0.0–1.0). Single source of truth — never expose via vehicleRef. */
  sprintStamina: number;
  /** Active vehicle type — gates HUD elements and post-processing. */
  vehicleType: 'runner' | 'raft';
}

export interface GameActions {
  setPlayerPosition: (pos: { x: number; y: number; z: number }) => void;
  setCurrentSpeed: (speed: number) => void;
  setCurrentBiome: (biome: string) => void;
  setIsPaused: (paused: boolean) => void;
  setDistanceTraveled: (distance: number) => void;
  setDistance: (distance: number) => void;
  setScore: (score: number) => void;
  setMultiplier: (multiplier: number) => void;
  setTopSpeed: (topSpeed: number) => void;
  setComboLabel: (comboLabel: string) => void;
  setHighScore: (highScore: number) => void;
  setCurrentSegmentIndex: (index: number) => void;
  setIsWipeout: (wipeout: boolean) => void;
  setJourneyComplete: () => void;
  setIsDodging: (dodging: boolean) => void;
  setRespawnSegmentIndex: (index: number) => void;
  setWaterfallGravityMultiplier: (multiplier: number) => void;
  setSpawnPoint: (segmentIndex: number, point: SpawnPoint) => void;
  setSettings: (settings: Partial<GameSettings>) => void;
  /** Clamps value to [0, 1] before writing. Call from useFrame via getState() — never via the hook. */
  setSprintStamina: (v: number) => void;
  setVehicleType: (type: 'runner' | 'raft') => void;
  resetGameState: () => void;
}

export type GameStore = GameState & GameActions;

// =============================================================================
// DEFAULTS
// =============================================================================

const DEFAULT_SETTINGS: GameSettings = {
  quality: 'high',
  soundVolume: 0.8,
};

const readStoredHighScore = (): number => {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem('watershed_highscore');
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

const INITIAL_STATE: GameState = {
  playerPosition: { x: 0, y: -4, z: -10 },
  currentSpeed: 0,
  currentBiome: 'canyonSummer',
  isPaused: false,
  distanceTraveled: 0,
  distance: 0,
  score: 0,
  multiplier: 1,
  topSpeed: 0,
  comboLabel: '',
  highScore: readStoredHighScore(),
  currentSegmentIndex: 0,
  isWipeout: false,
  isJourneyComplete: false,
  isDodging: false,
  respawnSegmentIndex: 0,
  waterfallGravityMultiplier: 1,
  spawnPoints: {},
  settings: { ...DEFAULT_SETTINGS },
  sprintStamina: 1.0,
  vehicleType: 'runner',
};

// =============================================================================
// STORE
// =============================================================================

export const useGameStore = create<GameStore>((set) => ({
  ...INITIAL_STATE,

  setPlayerPosition: (pos) =>
    set((state) => ({
      playerPosition: { ...state.playerPosition, ...pos },
    })),

  setCurrentSpeed: (speed) => set({ currentSpeed: speed }),

  setCurrentBiome: (biome) => set({ currentBiome: biome }),

  setIsPaused: (paused) => set({ isPaused: paused }),

  setDistanceTraveled: (distance) => set({ distanceTraveled: distance, distance }),

  setDistance: (distance) => set({ distance }),

  setScore: (score) => set({ score }),

  setMultiplier: (multiplier) => set({ multiplier }),

  setTopSpeed: (topSpeed) => set({ topSpeed }),

  setComboLabel: (comboLabel) => set({ comboLabel }),

  setHighScore: (highScore) => set({ highScore }),

  setCurrentSegmentIndex: (index) => set({ currentSegmentIndex: index }),

  setIsWipeout: (wipeout) => set({ isWipeout: wipeout }),

  setJourneyComplete: () =>
    set((state) => {
      const finalScore = state.score;
      const newHighScore = Math.max(state.highScore, finalScore);
      if (newHighScore > state.highScore && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('watershed_highscore', String(newHighScore));
        } catch {
          // ignore storage errors
        }
      }
      return {
        isJourneyComplete: true,
        isPaused: true,
        highScore: newHighScore,
      };
    }),

  setIsDodging: (dodging) => set({ isDodging: dodging }),

  setRespawnSegmentIndex: (index) => set({ respawnSegmentIndex: index }),

  setWaterfallGravityMultiplier: (multiplier) =>
    set({ waterfallGravityMultiplier: multiplier }),

  setSpawnPoint: (segmentIndex, point) =>
    set((state) => ({
      spawnPoints: { ...state.spawnPoints, [segmentIndex]: point },
    })),

  setSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
    })),

  setSprintStamina: (v) => set({ sprintStamina: Math.min(1, Math.max(0, v)) }),

  setVehicleType: (type) => set({ vehicleType: type }),

  resetGameState: () =>
    set({
      ...INITIAL_STATE,
      highScore: readStoredHighScore(),
      settings: { ...DEFAULT_SETTINGS },
    }),
}));

// =============================================================================
// SELECTOR HOOKS (convenience)
// =============================================================================

/** Subscribe only to player position — useful for UI that tracks coordinates */
export function usePlayerPosition() {
  return useGameStore((s) => s.playerPosition);
}

/** Subscribe only to speed — useful for speedometer HUD */
export function usePlayerSpeed() {
  return useGameStore((s) => s.currentSpeed);
}

/** Subscribe only to score */
export function useScore() {
  return useGameStore((s) => s.score);
}

/** Subscribe only to multiplier */
export function useMultiplier() {
  return useGameStore((s) => s.multiplier);
}

/** Subscribe only to combo label */
export function useComboLabel() {
  return useGameStore((s) => s.comboLabel);
}

/** Subscribe only to biome — useful for biome badge */
export function usePlayerBiome() {
  return useGameStore((s) => s.currentBiome);
}

/** Subscribe only to pause state */
export function useGamePaused() {
  return useGameStore((s) => s.isPaused);
}

/** Subscribe only to wipeout state */
export function useGameWipeout() {
  return useGameStore((s) => s.isWipeout);
}

/** Subscribe only to settings */
export function useGameSettings() {
  return useGameStore((s) => s.settings);
}

/** Subscribe only to quality preset */
export function useQualityPreset(): QualityPreset {
  return useGameStore((s) => s.settings.quality);
}

/**
 * Subscribe to the current gravity multiplier.
 * Useful for camera-shake intensity scaling, VFX, and particle behaviour.
 */
export function useGravityMultiplier(): number {
  return useGameStore((s) => s.waterfallGravityMultiplier);
}

// =============================================================================
// THROTTLED BATCH UPDATE (for useFrame callers)
// =============================================================================

let frameCount = 0;
const POSITION_UPDATE_INTERVAL = 3; // Update Zustand every 3rd frame

/**
 * Throttled frame update — call this inside `useFrame` to push physics state
 * into the store without hammering React on every frame.
 *
 * PERF: Only dispatches to Zustand every N frames. Physics-critical code
 * should read the rigid body ref directly, not the store.
 */
export function batchFrameUpdate(
  pos: { x: number; y: number; z: number },
  speed: number,
  segmentIndex: number
): void {
  frameCount += 1;

  if (frameCount % POSITION_UPDATE_INTERVAL === 0) {
    useGameStore.setState({
      playerPosition: pos,
      currentSpeed: speed,
      currentSegmentIndex: segmentIndex,
    });
  } else {
    // Speed and segment index are lower frequency — update every frame is fine
    // because few components subscribe to them.
    useGameStore.setState({
      currentSpeed: speed,
      currentSegmentIndex: segmentIndex,
    });
  }
}

export default useGameStore;
