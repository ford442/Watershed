export { createGameRenderer } from './createRenderer';
export { SHARED_CONTEXT_ATTRIBUTES, GL_CONTEXT_NAME } from './contextAttributes';
export {
  negotiateBootGraphics,
  probeGraphicsCapability,
  rendererContextAttributesFor,
  getSessionGraphicsCapability,
  getSessionGraphicsEnvelope,
  resetSessionGraphicsCapability,
  HARDWARE_ENVELOPE,
  DEGRADED_ENVELOPE,
  CAPTURE_ENVELOPE,
  type GraphicsCapability,
  type GraphicsCapabilityReason,
  type GraphicsEnvelope,
  type GraphicsTier,
} from './probeGraphicsCapability';
export {
  beginBootAttempt,
  markBootHealthy,
  recordBootFailure,
  readBootFailure,
  isBootAttemptOpen,
  BOOT_GUARD_KEY,
  FRAMES_TO_HEALTHY,
  type BootFailureReason,
  type BootFailureRecord,
} from './bootCrashGuard';
export { default as BootHealthSentinel } from './BootHealthSentinel';
export {
  deriveRendererContextOptions,
  deriveEditorContextOptions,
  rendererContextCreationKey,
  buildCanvasIdentityKey,
  toContextAttributes,
  resolveCanvasDpr,
  canvasDprRange,
  shadowModeToCanvasProp,
  DEFAULT_TONE_MAPPING_EXPOSURE,
  LOGARITHMIC_DEPTH_BUFFER_ENABLED,
  DESYNCHRONIZED_ENABLED,
  ULTRA_DPR_CEILING,
  EDITOR_QUALITY_PRESET,
  type RendererCreationAttributes,
  type RendererContextOptions,
  type RendererContextSettings,
  type ShadowMode,
} from './deriveRendererContextOptions';
export {
  RENDER_SCALE_MIN,
  RENDER_SCALE_MAX,
  RENDER_SCALE_STEP,
  SLOW_FRAME_RATIO,
  FAST_FRAME_RATIO,
  SCALE_DOWN_TICKS,
  SCALE_UP_TICKS,
  clampRenderScale,
  frameTimeBudgetMs,
  isRenderScaleAtCeiling,
  isRenderScaleAtFloor,
  stepRenderScale,
  type RenderScaleStepInput,
  type RenderScaleStepResult,
} from './renderScale';
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
