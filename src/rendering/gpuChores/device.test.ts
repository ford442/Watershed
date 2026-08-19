import { describe, expect, it } from 'vitest';
import { extractRendererGpuDevice, getSessionGpuDevice, registerSessionGpuDevice, resetSessionGpuDevice } from './device';

describe('session GPU device', () => {
  it('does not extract a device from a WebGL backend', () => {
    expect(extractRendererGpuDevice({ isWebGLRenderer: true })).toBeNull();
    expect(extractRendererGpuDevice({ backend: { isWebGPUBackend: false, device: {} } })).toBeNull();
  });

  it('adopts Three WebGPURenderer.backend.device when native WebGPU', () => {
    const device = { label: 'session' };
    const extracted = extractRendererGpuDevice({
      backend: { isWebGPUBackend: true, device },
    });
    expect(extracted).toBe(device);
  });

  it('register/get/reset round-trips', () => {
    resetSessionGpuDevice();
    expect(getSessionGpuDevice()).toBeNull();
    const device = { limits: { maxTextureDimension2D: 4096 }, features: new Set() } as unknown as GPUDevice;
    registerSessionGpuDevice(device);
    expect(getSessionGpuDevice()).toBe(device);
    resetSessionGpuDevice();
    expect(getSessionGpuDevice()).toBeNull();
  });
});
