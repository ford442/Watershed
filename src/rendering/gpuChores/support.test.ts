import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NO_GPU_COMPUTE_PARAM,
  detectGpuComputeSupport,
  isGpuComputeDisabledByFlag,
  publishChoreBreadcrumbs,
  publishGpuComputeBreadcrumbs,
  readGpuComputeDiagnostics,
} from './support';

afterEach(() => {
  vi.unstubAllGlobals();
  if (typeof window !== 'undefined') {
    delete window.gpuComputeAvailable;
    delete window.gpuComputeReason;
    delete window.gpuChoreBackend;
    delete window.gpuChoreReason;
  }
});

describe('gpu-chores support', () => {
  it('names the kill switch instead of a capability failure', () => {
    expect(isGpuComputeDisabledByFlag('?no_gpu_compute')).toBe(true);
    expect(isGpuComputeDisabledByFlag('?debug=1')).toBe(false);
    expect(NO_GPU_COMPUTE_PARAM).toBe('no_gpu_compute');
  });

  it('reports no device without pretending compute is present', () => {
    const support = detectGpuComputeSupport(null);
    expect(support.available).toBe(false);
    expect(support.reason).toBe('No GPU device');
  });

  it('kill switch wins even when a device exists', () => {
    vi.stubGlobal('location', { search: '?no_gpu_compute' });
    const device = {
      limits: { maxTextureDimension2D: 8192 },
      features: new Set<string>(),
    } as unknown as GPUDevice;
    const support = detectGpuComputeSupport(device);
    expect(support.available).toBe(false);
    expect(support.reason).toBe('Disabled by ?no_gpu_compute');
  });

  it('publishes breadcrumbs on window', () => {
    publishGpuComputeBreadcrumbs({ available: false, reason: 'No GPU device', maxTextureDimension2D: 0 });
    publishChoreBreadcrumbs('ts', null);
    expect(window.gpuComputeAvailable).toBe(false);
    expect(window.gpuComputeReason).toBe('No GPU device');
    expect(window.gpuChoreBackend).toBe('ts');
    expect(window.gpuChoreReason).toBeNull();
  });

  it('reads diagnostics defensively from a stub device', () => {
    const device = {
      limits: {},
      features: { [Symbol.iterator]: function* () { yield 'shader-f16'; } },
    } as unknown as GPUDevice;
    const diagnostics = readGpuComputeDiagnostics(device);
    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.vendor).toBe('unknown');
    expect(diagnostics?.features).toContain('shader-f16');
    expect(diagnostics?.limits.maxTextureDimension2D).toBe(0);
  });
});
