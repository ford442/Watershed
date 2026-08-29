/**
 * Systems barrel — intentionally thin.
 *
 * Prefer direct imports (`systems/map/ChunkManager`, `systems/audio/AudioSystem`, …).
 * This file re-exports only symbols the Experience provider shell historically
 * expected from a single entry; do not grow it into a junk drawer.
 *
 * Root-level modules that stay (deferred React hosts + store):
 *   GameState.ts, BiomeSystem.tsx, LODManager.tsx, SplashSystem.tsx
 */

export {
  BiomeProvider,
  BiomeTransition,
  BiomeDetector,
  useBiome,
  useBiomeMaterials,
} from './BiomeSystem';

export {
  LODProvider,
  FrustumCulling,
  LODObject,
  PerformanceMonitor,
  useLOD,
  QUALITY_SETTINGS,
} from './LODManager';

export { SplashSystem } from './SplashSystem';

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
