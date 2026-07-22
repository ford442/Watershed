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
  QUALITY_SETTINGS,
} from './LODManager';

// Planar water reflection texture publish/subscribe
export { useWaterReflectionStore } from './waterReflectionStore';

// Particles
export {
  ParticlePool,
  VFXParticle,
  FoamParticle,
  MistParticle,
  particleManager,
} from './ParticlePool';

// Splash effects
export { SplashSystem } from './SplashSystem';
export { default as WaterForceSystem } from './WaterForceSystem';
export { injectSWEDisturbance } from './SWEHeightField';
export {
  detectWaterContactEdge,
  cruiseSplashCount,
  mistSpawnCount,
  resolveSplashFrameEvents,
  raftSubmergedRatio,
  entryExitSplashCount,
} from './splashSpawnMath';

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
  useScore,
  useMultiplier,
  useComboLabel,
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

// Score system
export {
  tickScoreSystem,
  awardDodgeBonus,
  awardWaterfallBonus,
  resetScoreSystemState,
  commitJourneyScore,
} from './ScoreSystem';

// Persistence + ghost replay
export {
  loadPersistence,
  savePersistence,
  getRunBest,
  updateRunBest,
  buildRunKey,
  getLastMapId,
  setLastMapId,
  getCompletedMaps,
  markMapCompleted,
  getBestScoreForMap,
  getGhostBestScoreForMap,
  STORAGE_KEY,
  type PersistencePayload,
  type RunBest,
} from './PersistenceSystem';
export { initPersistence } from './persistenceBootstrap';
export {
  encodeGhostSamples,
  decodeGhost,
  decodeGhostFromBase64,
  GHOST_SAMPLE_HZ,
  type GhostSample,
} from './ghostCodec';
export {
  startGhostRecording,
  tickGhostRecording,
  persistGhostRecording,
} from './GhostRecorder';
