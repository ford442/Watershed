/**
 * `gpu-chores` — public entry (Watershed #369 / Tier B).
 *
 * Generic image/grid helpers for HUD, thumbs, and debug stats. SWE /
 * heightmap flow / TSL water materials stay domain and are not imported here
 * except via `watershedHost.ts`.
 */

export type {
  ChoreAttempt,
  ChoreBackend,
  ChoreBackendImpl,
  ChoreFailure,
  ChoreJob,
  ChoreOp,
  ChoreOutput,
  ChorePreference,
  ChoreResult,
  ChoreSuccess,
  ChoresRuntime,
  Downsample2dJob,
  Downsample2dOutput,
  GridReduceJob,
  GridReduceOutput,
  LumaHistogramJob,
  LumaHistogramOutput,
  SeparableBlurJob,
  SeparableBlurOutput,
} from './types';
export { CHORE_BACKEND_ORDER, HISTOGRAM_BINS } from './types';

export type { CpuChoreHost } from './cpuBackend';
export { CpuChoreBackend, createTsCpuHost } from './cpuBackend';

export { WebGpuChoreBackend } from './webgpuBackend';
export { ChoreRuntimeImpl, createChoresRuntime } from './runtime';

export type { GpuComputeDiagnostics, GpuComputeSupport } from './support';
export {
  NO_GPU_COMPUTE_PARAM,
  canAnalyzeTexture,
  detectGpuComputeSupport,
  isGpuComputeDisabledByFlag,
  publishChoreBreadcrumbs,
  publishGpuComputeBreadcrumbs,
  readGpuComputeDiagnostics,
} from './support';

export {
  extractRendererGpuDevice,
  getSessionGpuDevice,
  registerSessionGpuDevice,
  resetSessionGpuDevice,
  subscribeSessionGpuDevice,
} from './device';

export {
  createWatershedChoresRuntime,
  getChoresRuntime,
  resetChoresRuntime,
} from './createRuntime';
export type { ChoresRuntimeOptions } from './createRuntime';

export {
  bindChoreWasm,
  createWatershedCpuHost,
  hasChoreExports,
  resetChoreWasmBinding,
} from './watershedHost';

export {
  blurSeparableF32,
  downsampleF32,
  histogramF32,
  lumaHistogramU8,
  reduceF32,
} from './cpuMath';

export type { GpuChoreStats } from './statsStore';
export {
  getGpuChoreStats,
  resetGpuChoreStats,
  setGpuChoreStats,
  subscribeGpuChoreStats,
} from './statsStore';

export { runHeightfieldChores, resetHeightfieldChoresInFlight } from './heightfield';
