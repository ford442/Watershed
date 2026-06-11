import { detectActiveBackend, getRendererDisplayName } from './rendererState';

describe('rendererState', () => {
  it('detects pure WebGL renderer', () => {
    expect(detectActiveBackend({ isWebGLRenderer: true })).toBe('webgl');
  });

  it('detects native WebGPU backend', () => {
    expect(
      detectActiveBackend({
        isWebGPURenderer: true,
        backend: { isWebGPUBackend: true },
      })
    ).toBe('webgpu');
  });

  it('detects WebGPURenderer WebGL2 fallback backend', () => {
    expect(
      detectActiveBackend({
        isWebGPURenderer: true,
        backend: { isWebGPUBackend: false },
      })
    ).toBe('webgl2-fallback');
  });

  it('formats renderer display names', () => {
    expect(getRendererDisplayName('webgpu', 'webgpu')).toBe('WebGPURenderer');
    expect(getRendererDisplayName('webgpu', 'webgl2-fallback')).toBe('WebGPURenderer (WebGL2 fallback)');
    expect(getRendererDisplayName('webgl', 'webgl')).toBe('WebGLRenderer');
  });
});
