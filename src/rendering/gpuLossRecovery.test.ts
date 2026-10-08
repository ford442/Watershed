import { describe, expect, it, vi } from 'vitest';
import { attachGpuLossHandlers, isGpuLossDebugEnabled, simulateGpuLoss, type GpuLossKind } from './gpuLossRecovery';

function recorder() {
  const events: string[] = [];
  return {
    events,
    callbacks: {
      onLost: (kind: GpuLossKind) => events.push(`lost:${kind}`),
      onRestored: (kind: GpuLossKind) => events.push(`restored:${kind}`),
    },
  };
}

function nativeWebGPURenderer() {
  const destroy = vi.fn();
  const threeDefault = vi.fn();
  return {
    destroy,
    threeDefault,
    renderer: {
      domElement: document.createElement('canvas'),
      isWebGPURenderer: true,
      backend: { isWebGPUBackend: true, device: { destroy } },
      onDeviceLost: threeDefault as (info: unknown) => void,
    },
  };
}

describe('attachGpuLossHandlers — WebGL', () => {
  it('reports loss, waits for the browser restore, then asks for the remount', () => {
    const canvas = document.createElement('canvas');
    const { events, callbacks } = recorder();
    attachGpuLossHandlers({ domElement: canvas }, callbacks);

    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true); // or the browser never restores
    expect(events).toEqual(['lost:context-lost']);

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(events).toEqual(['lost:context-lost', 'restored:context-lost']);
  });

  it('detach removes the listeners (the old inline handlers leaked)', () => {
    const canvas = document.createElement('canvas');
    const { events, callbacks } = recorder();
    const detach = attachGpuLossHandlers({ domElement: canvas }, callbacks);
    detach();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(events).toEqual([]);
  });
});

describe('attachGpuLossHandlers — native WebGPU', () => {
  it('routes three onDeviceLost into loss + immediate remount, keeping three’s default', () => {
    const { renderer, threeDefault } = nativeWebGPURenderer();
    const { events, callbacks } = recorder();
    attachGpuLossHandlers(renderer, callbacks);

    renderer.onDeviceLost({ api: 'WebGPU', message: 'GPU hung', reason: 'unknown' });
    expect(threeDefault).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['lost:device-lost', 'restored:device-lost']);
  });

  it('restores three’s hook on detach', () => {
    const { renderer, threeDefault } = nativeWebGPURenderer();
    const { events, callbacks } = recorder();
    const detach = attachGpuLossHandlers(renderer, callbacks);
    detach();
    expect(renderer.onDeviceLost).toBe(threeDefault);
    renderer.onDeviceLost({ message: 'late' });
    expect(events).toEqual([]);
  });

  it('leaves the node renderer’s WebGL2 backend to the context events', () => {
    const threeDefault = vi.fn();
    const renderer = {
      domElement: document.createElement('canvas'),
      isWebGPURenderer: true,
      backend: { isWebGPUBackend: false },
      onDeviceLost: threeDefault,
    };
    attachGpuLossHandlers(renderer, recorder().callbacks);
    expect(renderer.onDeviceLost).toBe(threeDefault);
  });
});

describe('simulateGpuLoss (?debugGpuLoss=1)', () => {
  it('destroys the device and reports the loss through the hook, since three filters "destroyed"', () => {
    const { renderer, destroy } = nativeWebGPURenderer();
    const { events, callbacks } = recorder();
    attachGpuLossHandlers(renderer, callbacks);
    expect(simulateGpuLoss(renderer)).toBe('device-lost');
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['lost:device-lost', 'restored:device-lost']);
  });

  it('is gated on the query flag', () => {
    expect(isGpuLossDebugEnabled('?debugGpuLoss=1')).toBe(true);
    expect(isGpuLossDebugEnabled('?debug=1')).toBe(false);
  });
});
