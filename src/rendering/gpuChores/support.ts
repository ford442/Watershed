/**
 * `gpu-chores` — device/support detection for the WebGPU lane.
 *
 * Kill switch + adapter breadcrumbs so a Chrome failure is diagnosable from an
 * Edge failure after the fact. Ported from Chromashift #132 (Tier A).
 */

export interface GpuComputeSupport {
  available: boolean;
  reason: string | null;
  maxTextureDimension2D: number;
}

export interface GpuComputeDiagnostics {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  features: string[];
  limits: {
    maxTextureDimension2D: number;
    maxComputeWorkgroupSizeX: number;
    maxComputeWorkgroupSizeY: number;
    maxComputeInvocationsPerWorkgroup: number;
    maxStorageBufferBindingSize: number;
  };
}

/** URL kill switch: `?no_gpu_compute` forces the WebGPU lane closed. */
export const NO_GPU_COMPUTE_PARAM = 'no_gpu_compute';

export function isGpuComputeDisabledByFlag(search?: string): boolean {
  try {
    const raw =
      search ??
      (typeof window !== 'undefined' ? window.location.search : '');
    return new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`).has(
      NO_GPU_COMPUTE_PARAM,
    );
  } catch {
    return false;
  }
}

export function detectGpuComputeSupport(device: GPUDevice | null): GpuComputeSupport {
  if (!device) {
    return { available: false, reason: 'No GPU device', maxTextureDimension2D: 0 };
  }

  const maxTextureDimension2D = device.limits?.maxTextureDimension2D ?? 0;

  // Checked before the limits gate so the switch reports itself rather than
  // masquerading as a capability problem.
  if (isGpuComputeDisabledByFlag()) {
    return {
      available: false,
      reason: `Disabled by ?${NO_GPU_COMPUTE_PARAM}`,
      maxTextureDimension2D,
    };
  }

  if (maxTextureDimension2D < 1) {
    return {
      available: false,
      reason: 'Invalid maxTextureDimension2D',
      maxTextureDimension2D,
    };
  }

  return { available: true, reason: null, maxTextureDimension2D };
}

export function canAnalyzeTexture(
  support: GpuComputeSupport,
  width: number,
  height: number,
): boolean {
  if (!support.available) return false;
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  return w <= support.maxTextureDimension2D && h <= support.maxTextureDimension2D;
}

/**
 * Snapshot adapter identity + compute limits from the device.
 *
 * `GPUDevice.adapterInfo` is the spec-current accessor and is read
 * defensively: older Chrome/Edge builds expose it inconsistently, and this
 * must never be the thing that throws inside bootstrap.
 */
export function readGpuComputeDiagnostics(
  device: GPUDevice | null,
): GpuComputeDiagnostics | null {
  if (!device) return null;
  let info: Partial<GPUAdapterInfo> = {};
  try {
    info = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo ?? {};
  } catch {
    info = {};
  }

  let features: string[] = [];
  try {
    features = [...device.features];
  } catch {
    features = [];
  }

  const limits = (device.limits ?? {}) as Partial<GPUSupportedLimits>;
  return {
    vendor: info.vendor ?? 'unknown',
    architecture: info.architecture ?? 'unknown',
    device: info.device ?? 'unknown',
    description: info.description ?? 'unknown',
    features,
    limits: {
      maxTextureDimension2D: limits.maxTextureDimension2D ?? 0,
      maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX ?? 0,
      maxComputeWorkgroupSizeY: limits.maxComputeWorkgroupSizeY ?? 0,
      maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup ?? 0,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize ?? 0,
    },
  };
}

export function publishGpuComputeBreadcrumbs(
  support: GpuComputeSupport,
  diagnostics: GpuComputeDiagnostics | null = null,
): void {
  if (typeof window === 'undefined') return;
  window.gpuComputeAvailable = support.available;
  window.gpuComputeReason = support.reason;
  if (diagnostics !== null) window.gpuComputeDiagnostics = diagnostics;
}

export function publishChoreBreadcrumbs(
  backend: string | null,
  reason: string | null,
): void {
  if (typeof window === 'undefined') return;
  window.gpuChoreBackend = backend;
  window.gpuChoreReason = reason;
}
