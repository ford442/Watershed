/**
 * Systems barrel — intentionally thin.
 *
 * Prefer direct imports (`systems/map/ChunkManager`, `systems/audio/AudioSystem`, …).
 * This file re-exports only symbols the Experience provider shell historically
 * expected from a single entry; do not grow it into a junk drawer.
 *
 * Root-level modules that stay: GameState.ts and this file. Everything else
 * lives in a domain folder — `scripts/check-systems-layout.mjs` enforces it.
 */

export {
  BiomeProvider,
  BiomeTransition,
  BiomeDetector,
  useBiome,
  useBiomeMaterials,
} from './biome/BiomeSystem';

export {
  LODProvider,
  FrustumCulling,
  LODObject,
  PerformanceMonitor,
  useLOD,
  QUALITY_SETTINGS,
} from './lod/LODManager';

export { SplashSystem } from './water/SplashSystem';

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
  getQualityPresetNow,
  batchFrameUpdate,
  type QualityPreset,
  type GameSettings,
  type GameState,
  type GameActions,
  type GameStore,
} from './GameState';
