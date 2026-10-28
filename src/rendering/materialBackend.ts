/**
 * materialBackend.ts — which material implementation the scene builds.
 *
 * Path A of the WebGPU migration (#256) moves materials to NodeMaterial/TSL
 * *before* flipping the renderer, so the two risks land separately:
 *
 *   glsl  — legacy ShaderMaterial / onBeforeCompile, classic THREE.WebGLRenderer.
 *   tsl   — NodeMaterial graphs. These CANNOT run on THREE.WebGLRenderer: it has
 *           no node pipeline. They run on WebGPURenderer with `forceWebGL: true`
 *           (WebGL2 on the wire), or on native WebGPU with `?renderer=webgpu`
 *           while `nativeWebgpuGate.ts` is open (no residual GLSL host, post
 *           ported — true since epic #434).
 *
 * Default stays `glsl`. Production is unchanged unless the flag is set.
 */

import { currentSearch } from '../config/queryFlags';
export type MaterialBackend = 'glsl' | 'tsl';

export type MaterialBackendReason =
  | 'query-tsl'
  | 'query-glsl'
  | 'stored-tsl'
  | 'default-glsl'
  | 'unsupported'
  | 'renderer-fallback';

export interface MaterialBackendDecision {
  backend: MaterialBackend;
  reason: MaterialBackendReason;
}

export interface MaterialBackendEnvironment {
  /** Query string (with or without a leading '?'). Defaults to the page's (`currentSearch()`). */
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
  'renderer-fallback': 'node renderer failed to start — GLSL fallback for this session',
};

const STORAGE_KEY = 'watershed.material.backend';

export function isMaterialBackend(value: unknown): value is MaterialBackend {
  return value === 'glsl' || value === 'tsl';
}

/** Explicit `?material=` override, or null when absent/unrecognised. */
export function parseMaterialBackendParam(search?: string): MaterialBackend | null {
  const raw =
    search ?? (currentSearch());
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

// ── Session override ────────────────────────────────────────────────────────
//
// `createGameRenderer` falls back to THREE.WebGLRenderer when the node renderer
// cannot start (init() throws, bridging throws, no context) — after
// `loadNodeMaterials()` may already have resolved. Every material host resolves
// its backend from the URL / storage, which still say `tsl`, and finds the node
// modules loaded: NodeMaterials on a WebGLRenderer. The fallback therefore pins
// the session to glsl here, *before* any host resolves, and every later
// resolution (this Canvas and any remount) reads the pin first.

let sessionOverride: MaterialBackendDecision | null = null;
let sceneResolvedTsl = false;

/** Pin this session's backend. Called by the renderer factory's GLSL fallback. */
export function pinSessionMaterialBackend(decision: MaterialBackendDecision): void {
  sessionOverride = decision;
}

/** The pinned decision, or null when the session follows URL / storage. */
export function getSessionMaterialBackend(): MaterialBackendDecision | null {
  return sessionOverride;
}

/**
 * True once a scene host resolved `tsl` (a production `resolveMaterialBackend()`
 * call with nothing injected). A renderer fallback after that point cannot fix
 * the materials already built; it must remount instead.
 */
export function hasSceneResolvedTsl(): boolean {
  return sceneResolvedTsl;
}

/** Test seam: forget the pin and the host bookkeeping. */
export function resetSessionMaterialBackend(): void {
  sessionOverride = null;
  sceneResolvedTsl = false;
}

/**
 * Resolve the material backend, and why. Every input can be injected.
 *
 * Precedence: session pin (renderer fallback) > `?material=` > stored debug
 * preference > default glsl. Capability gating collapses any tsl decision back
 * to glsl.
 *
 * This is the *material host* entry point: a call with no injected query
 * string that lands on tsl is recorded (`hasSceneResolvedTsl`). Callers that
 * only want to know what was requested — the renderer request, the debug
 * panel — use `requestedMaterialBackend`.
 */
export function resolveMaterialBackend(
  env: MaterialBackendEnvironment = {},
): MaterialBackendDecision {
  if (sessionOverride) return sessionOverride;
  const decision = decideMaterialBackend(env);
  if (decision.backend === 'tsl' && env.search === undefined) sceneResolvedTsl = true;
  return decision;
}

/**
 * What the session asks for — the same decision as `resolveMaterialBackend`
 * without counting as a material host. App's renderer request and the debug
 * panel read this.
 */
export function requestedMaterialBackend(
  env: MaterialBackendEnvironment = {},
): MaterialBackendDecision {
  return sessionOverride ?? decideMaterialBackend(env);
}

function decideMaterialBackend(env: MaterialBackendEnvironment): MaterialBackendDecision {
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
