/**
 * materialBackend.ts — which material implementation the scene builds.
 *
 * Path A of the WebGPU migration (#256) moves materials to NodeMaterial/TSL
 * *before* flipping the renderer, so the two risks land separately:
 *
 *   glsl  — legacy ShaderMaterial / onBeforeCompile, classic THREE.WebGLRenderer.
 *   tsl   — NodeMaterial graphs. These CANNOT run on THREE.WebGLRenderer: it has
 *           no node pipeline. They run on WebGPURenderer, which is created with
 *           `forceWebGL: true` unless the WebGPU preference is also set — so the
 *           GPU API stays WebGL2 while the material pipeline changes.
 *
 * That distinction is the whole point of Path A: `?material=tsl` alone changes
 * materials and the renderer *class*, but not the graphics API. Only once every
 * live material is TSL does `?renderer=webgpu` get to select a real WebGPU
 * backend (Phase 3, deliberately still gated).
 *
 * Default stays `glsl`. Production is unchanged unless the flag is set.
 */

export type MaterialBackend = 'glsl' | 'tsl';

export type MaterialBackendReason =
  | 'query-tsl'
  | 'query-glsl'
  | 'stored-tsl'
  | 'default-glsl'
  | 'unsupported';

export interface MaterialBackendDecision {
  backend: MaterialBackend;
  reason: MaterialBackendReason;
}

export interface MaterialBackendEnvironment {
  /** Query string (with or without a leading '?'). Defaults to window.location.search. */
  search?: string;
  /** Stored preference from the debug toggle. Defaults to localStorage. */
  stored?: MaterialBackend | null;
  /**
   * Whether a node-capable renderer can be constructed here. False forces glsl —
   * a TSL material with no node renderer would render as an untextured surface
   * at best, and throw at worst.
   */
  nodeRendererSupported?: boolean;
}

export const MATERIAL_BACKEND_REASON_LABELS: Record<MaterialBackendReason, string> = {
  'query-tsl': 'forced by ?material=tsl',
  'query-glsl': 'forced by ?material=glsl',
  'stored-tsl': 'enabled in debug panel',
  'default-glsl': 'default (legacy GLSL)',
  unsupported: 'no node-capable renderer available',
};

const STORAGE_KEY = 'watershed.material.backend';

export function isMaterialBackend(value: unknown): value is MaterialBackend {
  return value === 'glsl' || value === 'tsl';
}

/** Explicit `?material=` override, or null when absent/unrecognised. */
export function parseMaterialBackendParam(search?: string): MaterialBackend | null {
  const raw =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const value = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`).get('material');
  return isMaterialBackend(value) ? value : null;
}

export function readStoredMaterialBackend(): MaterialBackend | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isMaterialBackend(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function persistMaterialBackend(backend: MaterialBackend): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, backend);
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

/**
 * WebGPURenderer (the only node-capable renderer, WebGL2 backend included) needs
 * a browser with WebGL2 at minimum. jsdom and ancient browsers get glsl.
 */
export function detectNodeRendererSupport(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof WebGL2RenderingContext !== 'undefined';
}

/**
 * Resolve the material backend, and why. Pure — every input can be injected.
 *
 * Precedence: `?material=` > stored debug preference > default glsl. Capability
 * gating collapses any tsl decision back to glsl.
 */
export function resolveMaterialBackend(
  env: MaterialBackendEnvironment = {},
): MaterialBackendDecision {
  const supported = env.nodeRendererSupported ?? detectNodeRendererSupport();
  const query = parseMaterialBackendParam(env.search);

  if (query === 'glsl') return { backend: 'glsl', reason: 'query-glsl' };
  if (query === 'tsl') {
    return supported
      ? { backend: 'tsl', reason: 'query-tsl' }
      : { backend: 'glsl', reason: 'unsupported' };
  }

  const stored = env.stored !== undefined ? env.stored : readStoredMaterialBackend();
  if (stored === 'tsl') {
    return supported
      ? { backend: 'tsl', reason: 'stored-tsl' }
      : { backend: 'glsl', reason: 'unsupported' };
  }

  return { backend: 'glsl', reason: 'default-glsl' };
}

/** Convenience boolean for call sites that don't need the reason. */
export function isTslBackend(env: MaterialBackendEnvironment = {}): boolean {
  return resolveMaterialBackend(env).backend === 'tsl';
}
