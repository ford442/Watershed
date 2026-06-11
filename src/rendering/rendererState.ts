/**
 * Module-level renderer diagnostics store.
 * Crosses the R3F Canvas boundary (same pattern as perfMetrics.ts).
 */

import type { ActiveRendererBackend, RendererDiagnostics, RendererPreference } from './types';

const _diagnostics: RendererDiagnostics = {
  preference: 'webgpu',
  activeBackend: 'webgl',
  rendererName: 'WebGLRenderer',
  webgpuAvailable: false,
};

type Listener = () => void;
const _listeners = new Set<Listener>();

export function getRendererDiagnostics(): Readonly<RendererDiagnostics> {
  return _diagnostics;
}

export function updateRendererDiagnostics(partial: Partial<RendererDiagnostics>): void {
  Object.assign(_diagnostics, partial);
  _listeners.forEach((fn) => fn());
}

export function subscribeRendererDiagnostics(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function detectActiveBackend(renderer: {
  isWebGLRenderer?: boolean;
  isWebGPURenderer?: boolean;
  backend?: { isWebGPUBackend?: boolean };
}): ActiveRendererBackend {
  if (renderer.isWebGLRenderer) return 'webgl';
  if (renderer.isWebGPURenderer) {
    return renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2-fallback';
  }
  return 'webgl';
}

export function isWebGpuNavigatorAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
}

export function getRendererDisplayName(
  preference: RendererPreference,
  activeBackend: ActiveRendererBackend
): string {
  if (activeBackend === 'webgpu') return 'WebGPURenderer';
  if (activeBackend === 'webgl2-fallback') return 'WebGPURenderer (WebGL2 fallback)';
  if (preference === 'webgpu') return 'WebGLRenderer (forced debug)';
  return 'WebGLRenderer';
}
