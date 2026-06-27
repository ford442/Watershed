import { createGameRenderer } from './createRenderer';

jest.mock('./cspProbe', () => ({
  isDataUrlConnectAllowed: jest.fn().mockResolvedValue(true),
}));

jest.mock('./rendererConfig', () => ({
  persistRendererPreference: jest.fn(),
}));

describe('createGameRenderer', () => {
  const canvasProps = { canvas: document.createElement('canvas') };

  it('returns WebGLRenderer when preference is webgl', async () => {
    const renderer = await createGameRenderer(canvasProps, { preference: 'webgl' });
    expect(renderer.isWebGLRenderer).toBe(true);
    expect(renderer.isWebGPURenderer).toBeFalsy();
    renderer.dispose();
  });

  it('falls back to WebGLRenderer when preference is webgpu (legacy materials)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const renderer = await createGameRenderer(canvasProps, { preference: 'webgpu' });
    expect(renderer.isWebGLRenderer).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Legacy GLSL materials are incompatible with WebGPURenderer')
    );
    warnSpy.mockRestore();
    renderer.dispose();
  });
});
