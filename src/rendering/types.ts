/** Requested renderer backend via URL param or debug UI. */
export type RendererPreference = 'webgl' | 'webgpu';

/** Actual GPU backend after initialization (WebGPURenderer may fall back to WebGL2). */
export type ActiveRendererBackend = 'webgl' | 'webgl2-fallback' | 'webgpu';

export interface RendererDiagnostics {
  preference: RendererPreference;
  activeBackend: ActiveRendererBackend;
  rendererName: string;
  webgpuAvailable: boolean;
}
