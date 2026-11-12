/**
 * floatFiltering.ts — can this renderer linearly filter a 32-bit float texture? (#554 B.1)
 *
 * WebGL2 makes RGBA32F filterable only behind `OES_texture_float_linear`, which most
 * mobile GPUs lack. three does not fall back: it warns and keeps `LINEAR` on the
 * texture, which leaves it *incomplete*, so every sample reads 0. WebGPU likewise needs
 * the optional `float32-filterable` feature. Half floats (RGBA16F) filter everywhere.
 *
 * Returns null when the renderer cannot be asked (a test double, no renderer yet):
 * callers keep their 32-bit default then.
 */
export function rendererFiltersFloat32(renderer: unknown): boolean | null {
  if (!renderer || typeof renderer !== 'object') return null;
  try {
    const r = renderer as {
      isWebGPURenderer?: boolean;
      hasFeature?: (name: string) => boolean;
      extensions?: { has?: (name: string) => boolean };
      backend?: { extensions?: { has?: (name: string) => boolean } | null };
    };
    if (r.isWebGPURenderer === true) {
      // The WebGL2 fallback backend maps no feature name to this extension, so ask its
      // extension table directly (only that backend has one). Detected by shape, not by
      // its class flag: the entry chunk must not name the node backend (check-build-manifest).
      const backendExtensions = r.backend?.extensions;
      if (backendExtensions && typeof backendExtensions.has === 'function') {
        return backendExtensions.has('OES_texture_float_linear');
      }
      return typeof r.hasFeature === 'function' ? r.hasFeature('float32-filterable') : null;
    }
    return typeof r.extensions?.has === 'function' ? r.extensions.has('OES_texture_float_linear') : null;
  } catch {
    return null;
  }
}
