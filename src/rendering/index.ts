export { createGameRenderer } from './createRenderer';
export {
  createGameRendererWithCaveatFallback,
  CAVEAT_FALLBACK_PRESET,
  type CaveatFallbackInfo,
  type CaveatFallbackInput,
} from './bootRendererFallback';
export {
  deriveRendererContextOptions,
  deriveEditorContextOptions,
  rendererContextCreationKey,
  buildCanvasIdentityKey,
  toContextAttributes,
  resolveCanvasDpr,
  shadowModeToCanvasProp,
  DEFAULT_TONE_MAPPING_EXPOSURE,
  LOGARITHMIC_DEPTH_BUFFER_ENABLED,
  DESYNCHRONIZED_ENABLED,
  SHARED_CONTEXT_ATTRIBUTES,
  ULTRA_DPR_CEILING,
  LOW_PRESET_POWER_PREFERENCE,
  EDITOR_QUALITY_PRESET,
  type RendererCreationAttributes,
  type RendererContextOptions,
  type RendererContextSettings,
  type ShadowMode,
} from './deriveRendererContextOptions';
export {
  applyRendererContextOptions,
  applyRendererQualityUpdate,
  getRendererShadowMapSize,
} from './applyRendererContextOptions';
export {
  parseRendererPreference,
  persistRendererPreference,
  syncRendererPreferenceToUrl,
  isVisualCaptureMode,
  isSoftwareRendererAllowed,
} from './rendererConfig';
export { getRendererDiagnostics, subscribeRendererDiagnostics } from './rendererState';
export type { ActiveRendererBackend, RendererDiagnostics, RendererPreference } from './types';
export { default as RendererDiagnosticsMonitor } from './RendererDiagnosticsMonitor';
export { default as RendererQualitySync } from './RendererQualitySync';
export { default as WireframeDebug } from './WireframeDebug';
