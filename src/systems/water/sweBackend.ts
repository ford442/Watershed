/**
 * sweBackend — which solver steps the one live SWE field (#391 Phase D, #435).
 *
 *   wasm — the C++ HLL stepper (emscripten/swe.cpp). Every WebGL2 session, and
 *          the default whenever WGSL is not clearly available.
 *   wgsl — its WGSL twin (swe.wgsl / WgslSweSim.ts) on the renderer's own
 *          GPUDevice. Only on a native-WebGPU boot.
 *
 * Resolved once per session and memoized: a session never steps both. The
 * decision needs the renderer's device, so the first call must come after the
 * Canvas `gl` factory has registered it (WaterForceSystem mounts inside the
 * Canvas, which guarantees that). gpu-chores share the same device and still
 * never step water.
 */
import { canEnableNativeWebgpu } from '../../rendering/nativeWebgpuGate';
import { getSessionGpuDevice } from '../../rendering/gpuChores/device';

export type SweSimBackend = 'wasm' | 'wgsl';

export type SweBackendReason =
  | 'query-wasm'
  | 'native-webgpu'
  | 'gate-closed'
  | 'no-webgpu-device'
  | 'device-limits'
  | 'wgsl-init-failed';

export interface SweBackendDecision {
  backend: SweSimBackend;
  reason: SweBackendReason;
}

export interface SweBackendInputs {
  /** `canEnableNativeWebgpu()` — residual GLSL gone and post ported. */
  nativeWebgpuGate: boolean;
  /** The session device the renderer registered; null on a WebGL2 backend. */
  device: Pick<GPUDevice, 'limits'> | null;
  /** Query string; `?swe=wasm` pins the C++ stepper for A/B checks. */
  search?: string;
}

/** Storage buffers the WGSL kernels bind per stage (field, scratch, max). */
const WGSL_STORAGE_BUFFERS = 3;

/** Pure decision — `resolveSweSimBackend()` feeds it the live session state. */
export function chooseSweSimBackend(inputs: SweBackendInputs): SweBackendDecision {
  const query = new URLSearchParams(inputs.search ?? '').get('swe');
  if (query === 'wasm') return { backend: 'wasm', reason: 'query-wasm' };
  if (!inputs.nativeWebgpuGate) return { backend: 'wasm', reason: 'gate-closed' };
  if (!inputs.device) return { backend: 'wasm', reason: 'no-webgpu-device' };
  const limits = inputs.device.limits;
  if (limits.maxStorageBuffersPerShaderStage < WGSL_STORAGE_BUFFERS || limits.maxComputeWorkgroupSizeX < 64) {
    return { backend: 'wasm', reason: 'device-limits' };
  }
  return { backend: 'wgsl', reason: 'native-webgpu' };
}

let resolved: SweBackendDecision | null = null;

/** The session's SWE backend, decided on first call and fixed afterwards. */
export function resolveSweSimBackend(): SweSimBackend {
  return resolveSweSimBackendDecision().backend;
}

export function resolveSweSimBackendDecision(): SweBackendDecision {
  if (!resolved) {
    resolved = chooseSweSimBackend({
      nativeWebgpuGate: canEnableNativeWebgpu(),
      device: getSessionGpuDevice(),
      search: typeof window !== 'undefined' ? window.location.search : '',
    });
  }
  return resolved;
}

/**
 * Fall back to WASM when the WGSL pipelines fail to build. Only legal before
 * the WGSL field has stepped — callers demote from the creation failure path,
 * so the session still only ever steps one backend.
 */
export function demoteSweSimBackendToWasm(): SweBackendDecision {
  resolved = { backend: 'wasm', reason: 'wgsl-init-failed' };
  return resolved;
}

/** Test seam. */
export function resetSweSimBackendForTests(): void {
  resolved = null;
}
