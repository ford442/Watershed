/**
 * Hooks Module
 * 
 * Export all custom React hooks.
 */

export { useLevel } from './useLevel';
export type { UseLevelReturn, LevelState, NormalizedLevelState } from './useLevel';
export { useCameraShake } from './useCameraShake';
export { useShaderLoader, useShaderList, preloadShader, clearShaderCache } from './useShaderLoader';
export type { ShaderLoadResult, ShaderMetadata } from './useShaderLoader';
export { useWaterFlowField } from './useWaterFlowField';
export { useRiverAudio } from './useRiverAudio';
export { useVortexForce } from './useVortexForce';
export { useShaderBrowser } from './useShaderBrowser';
export type { Shader as ShaderBrowserShader } from './useShaderBrowser';
export { useNightMode } from './useNightMode';
export type { NightModeState } from './useNightMode';

// Goal 1: Chunk loading hook
export { useChunkLoader } from './useChunkLoader';
export type { UseChunkLoaderOptions, UseChunkLoaderResult } from './useChunkLoader';

// Goal 2: Unified player input hook
export { usePlayerControls } from './usePlayerControls';
export type { PlayerControls, PlayerControlVectors } from './usePlayerControls';

// Goal 3: Segment-aware ambient audio
export { useSegmentAudio } from './useSegmentAudio';
export type { SegmentAudioPhase } from './useSegmentAudio';
