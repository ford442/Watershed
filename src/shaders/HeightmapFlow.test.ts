import { describe, expect, it, vi } from 'vitest';
import { HeightmapFlowController } from './HeightmapFlow';
import { resetSessionGpuDevice } from '../rendering/gpuChores/device';

describe('HeightmapFlow device adoption', () => {
  it('does not call requestAdapter/requestDevice', async () => {
    const requestAdapter = vi.fn();
    const requestDevice = vi.fn();
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter, requestDevice },
    });
    resetSessionGpuDevice();
    const controller = new HeightmapFlowController({ size: 8 });
    await controller.initWebGPU();
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(requestDevice).not.toHaveBeenCalled();
    controller.dispose();
    vi.unstubAllGlobals();
  });

  it('stays on the CPU path when no session device is registered', async () => {
    resetSessionGpuDevice();
    const controller = new HeightmapFlowController({ size: 8 });
    await controller.initWebGPU();
    controller.update(0.016, 1);
    expect(controller.flowMapTexture.image.data).toBeInstanceOf(Float32Array);
    expect((controller.flowMapTexture.image.data as Float32Array).length).toBe(8 * 8 * 4);
    controller.dispose();
  });
});
