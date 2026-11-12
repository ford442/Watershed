import { describe, expect, it } from 'vitest';
import { rendererFiltersFloat32 } from './floatFiltering';

const exts = (names: string[]) => ({ has: (name: string) => names.includes(name) });

describe('rendererFiltersFloat32', () => {
  it('reads OES_texture_float_linear on a WebGLRenderer', () => {
    expect(rendererFiltersFloat32({ extensions: exts(['OES_texture_float_linear']) })).toBe(true);
    expect(rendererFiltersFloat32({ extensions: exts([]) })).toBe(false);
  });

  it('reads float32-filterable on a native WebGPU backend', () => {
    const r = (features: string[]) => ({
      isWebGPURenderer: true,
      backend: {},
      hasFeature: (name: string) => features.includes(name),
    });
    expect(rendererFiltersFloat32(r(['float32-filterable']))).toBe(true);
    expect(rendererFiltersFloat32(r([]))).toBe(false);
  });

  it('asks the WebGL2 fallback backend for the extension, not a feature name', () => {
    const r = {
      isWebGPURenderer: true,
      hasFeature: () => false,
      backend: { extensions: exts(['OES_texture_float_linear']) },
    };
    expect(rendererFiltersFloat32(r)).toBe(true);
  });

  it('is null when the renderer cannot be asked', () => {
    expect(rendererFiltersFloat32(undefined)).toBeNull();
    expect(rendererFiltersFloat32({})).toBeNull();
  });
});
