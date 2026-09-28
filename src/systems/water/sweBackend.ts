/**
 * sweBackend — which solver steps the one live SWE field (#391 Phase D, #435,
 * #455).
 *
 *   wasm-worker — the C++ HLL stepper (emscripten/swe.cpp) in the sim worker
 *                 (src/sim/). Default whenever WGSL is not clearly available.
 *   wasm-main   — the same stepper on the main thread. `?simWorker=0`, no
 *                 `Worker`, or the sim worker failed its handshake.
 *   wgsl        — the WGSL twin (swe.wgsl / WgslSweSim.ts) on the renderer's
 *                 own GPUDevice, on the main thread (it needs that device, and
 *                 the worker must never request a second one). Native-WebGPU
 *                 boots only.
 *
 * Resolved once per session and memoized: a session never steps both. The
 * decision needs the renderer's device, so the first call must come after the
 * Canvas `gl` factory has registered it (WaterForceSystem mounts inside the
 * Canvas, which guarantees that). gpu-chores share the same device and still
 * never step water.
 */
import { canEnableNativeWebgpu } from '../../rendering/nativeWebgpuGate';
import { getSessionGpuDevice } from '../../rendering/gpuChores/device';

export type SweSimBackend = 'wasm-worker' | 'wasm-main' | 'wgsl';

export type SweBackendReason =
  | 'query-wasm'
  | 'native-webgpu'
  | 'gate-closed'
  | 'no-webgpu-device'
  | 'device-limits'
  | 'wgsl-init-failed'
  | 'sim-worker-off'
  | 'no-worker'
  | 'sim-worker-failed';

export interface SweBackendDecision {
  backend: SweSimBackend;
  reason: SweBackendReason;
}

export interface SweBackendInputs {
  /** `canEnableNativeWebgpu()` — residual GLSL gone and post ported. */
  nativeWebgpuGate: boolean;
  /** The session device the renderer registered; null on a WebGL2 backend. */
  device: Pick<GPUDevice, 'limits'> | null;
  /**
   * Query string; `?swe=wasm` pins the C++ stepper for A/B checks, and
   * `?simWorker=0` keeps it on the main thread (kill switch).
   */
  search?: string;
  /** `typeof Worker === 'function'` — false under Node / jsdom. */
  workerAvailable?: boolean;
}

/** Storage buffers the WGSL kernels bind per stage (field, scratch, max). */
const WGSL_STORAGE_BUFFERS = 3;

/** The C++ stepper: in the sim worker unless switched off or impossible. */
function wasmStepper(inputs: SweBackendInputs, params: URLSearchParams, reason: SweBackendReason): SweBackendDecision {
  if (params.get('simWorker') === '0') return { backend: 'wasm-main', reason: 'sim-worker-off' };
  if (!inputs.workerAvailable) return { backend: 'wasm-main', reason: 'no-worker' };
  return { backend: 'wasm-worker', reason };
}

/** Pure decision — `resolveSweSimBackend()` feeds it the live session state. */
export function chooseSweSimBackend(inputs: SweBackendInputs): SweBackendDecision {
  const params = new URLSearchParams(inputs.search ?? '');
  if (params.get('swe') === 'wasm') return wasmStepper(inputs, params, 'query-wasm');
  if (!inputs.nativeWebgpuGate) return wasmStepper(inputs, params, 'gate-closed');
  if (!inputs.device) return wasmStepper(inputs, params, 'no-webgpu-device');
  const limits = inputs.device.limits;
  if (limits.maxStorageBuffersPerShaderStage < WGSL_STORAGE_BUFFERS || limits.maxComputeWorkgroupSizeX < 64) {
    return wasmStepper(inputs, params, 'device-limits');
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
      workerAvailable: typeof Worker === 'function',
    });
  }
  return resolved;
}

/**
 * Fall back to the main-thread WASM stepper when the WGSL pipelines fail to
 * build. Only legal before the WGSL field has stepped — callers demote from the
 * creation failure path, so the session still only ever steps one backend.
 */
export function demoteSweSimBackendToWasm(): SweBackendDecision {
  resolved = { backend: 'wasm-main', reason: 'wgsl-init-failed' };
  return resolved;
}

/**
 * Fall back to the main-thread stepper when the sim worker cannot be built or
 * misses its handshake. Same rule: only before the worker field has stepped.
 */
export function demoteSweSimBackendToWasmMain(): SweBackendDecision {
  resolved = { backend: 'wasm-main', reason: 'sim-worker-failed' };
  return resolved;
}

/** Test seam. */
export function resetSweSimBackendForTests(): void {
  resolved = null;
}
