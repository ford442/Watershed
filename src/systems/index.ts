/**
 * Systems Module
 *
 * Export all game systems.
 */

// Level loading
export { default as LevelLoader } from './LevelLoader';
export { ErrorDisplay, LoadingDisplay } from './LevelLoader';

// Biome system
export {
  BiomeProvider,
  BiomeTransition,
  BiomeDetector,
  useBiome,
  useBiomeMaterials,
} from './BiomeSystem';

// LOD and performance
export {
  LODProvider,
  FrustumCulling,
  LODObject,
  PerformanceMonitor,
  useLOD,
} from './LODManager';

// Particles
export {
  ParticlePool,
  VFXParticle,
  FoamParticle,
  particleManager,
} from './ParticlePool';

// Splash effects
export { SplashSystem } from './SplashSystem';

// Post-processing
export { PostProcessing } from './PostProcessing';

// Chunk management (Goal 1)
export {
  ChunkManager,
  type SegmentData,
  type RenderedSlot,
  type ChunkManagerCallbacks,
  type ChunkManagerOptions,
  type ChunkManagerStats,
} from './ChunkManager';

// Game state (Goal 1) — Zustand store
export {
  useGameStore,
  usePlayerPosition,
  usePlayerSpeed,
  usePlayerBiome,
  useGamePaused,
  useGameWipeout,
  useGameSettings,
  useQualityPreset,
  batchFrameUpdate,
  type QualityPreset,
  type GameSettings,
  type GameState,
  type GameActions,
  type GameStore,
} from './GameState';
