/**
 * sweBackend — one live SWE sim per boot (#391 Phase D).
 *
 * Until leftover GLSL is gone, C++ WASM is the only stepper. gpu-chores may
 * share the session GPUDevice; they must not step water. HeightmapFlow is
 * dormant and must not become a third live field.
 *
 * Phase D (not started): port the same numerics to public/shaders/swe.wgsl
 * and pick wasm *or* wgsl at boot — never both.
 */

export type SweSimBackend = 'wasm';

export const LIVE_SWE_BACKEND: SweSimBackend = 'wasm';

export function resolveSweSimBackend(): SweSimBackend {
  return LIVE_SWE_BACKEND;
}
