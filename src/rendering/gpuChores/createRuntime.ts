/**
 * Assemble a Watershed chores runtime from the session device + CPU host.
 */

import { CpuChoreBackend, type CpuChoreHost } from './cpuBackend';
import { getSessionGpuDevice } from './device';
import { createChoresRuntime } from './runtime';
import { detectGpuComputeSupport, isGpuComputeDisabledByFlag } from './support';
import type { ChoreBackendImpl, ChoresRuntime } from './types';
import { WebGpuChoreBackend } from './webgpuBackend';
import { createWatershedCpuHost } from './watershedHost';

export interface ChoresRuntimeOptions {
  /**
   * Renderer-owned device. Pass `null` on a WebGL backend (or when compute is
   * killed) and no `webgpu` lane is registered at all.
   */
  device?: GPUDevice | null;
  gpuBackend?: ChoreBackendImpl | null;
  cpuHost?: CpuChoreHost | null;
}

export function createWatershedChoresRuntime(
  options: ChoresRuntimeOptions = {},
): ChoresRuntime {
  const backends: ChoreBackendImpl[] = [];
  const device = options.device === undefined ? getSessionGpuDevice() : options.device;
  if (options.gpuBackend) {
    backends.push(options.gpuBackend);
  } else if (device && detectGpuComputeSupport(device).available && !isGpuComputeDisabledByFlag()) {
    backends.push(new WebGpuChoreBackend(device));
  }
  const cpuHost = options.cpuHost ?? createWatershedCpuHost();
  backends.push(new CpuChoreBackend('wasm', cpuHost));
  backends.push(new CpuChoreBackend('ts', cpuHost));
  return createChoresRuntime(backends);
}

let cached: { device: GPUDevice | null; runtime: ChoresRuntime } | null = null;

export function getChoresRuntime(): ChoresRuntime {
  const device = isGpuComputeDisabledByFlag() ? null : getSessionGpuDevice();
  if (cached && cached.device === device) return cached.runtime;
  cached?.runtime.destroy();
  const runtime = createWatershedChoresRuntime({ device });
  cached = { device, runtime };
  return runtime;
}

export function resetChoresRuntime(): void {
  cached?.runtime.destroy();
  cached = null;
}
