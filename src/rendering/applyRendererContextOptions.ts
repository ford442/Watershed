import * as THREE from 'three';
import type { RendererContextOptions } from './deriveRendererContextOptions';

/**
 * Structural view of what this module configures. WebGPURenderer is not a
 * THREE.WebGLRenderer but exposes the same four knobs, so the TSL material path
 * (#256 path A) can reuse this without a cast at every call site.
 */
export interface RendererContextTarget {
  outputColorSpace: THREE.ColorSpace;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
}

/** Shadow map size contract keyed by renderer instance (renderers have no userData). */
const shadowMapSizeByRenderer = new WeakMap<object, number | null>();

export function getRendererShadowMapSize(
  renderer: object
): number | null | undefined {
  return shadowMapSizeByRenderer.get(renderer);
}

/**
 * Apply tone mapping, color space, and shadow configuration once at renderer setup.
 * Called from createGameRenderer after the WebGL context is created.
 */
export function applyRendererContextOptions(
  renderer: RendererContextTarget,
  options: RendererContextOptions
): void {
  renderer.outputColorSpace = options.outputColorSpace;
  renderer.toneMapping = options.toneMapping;
  renderer.toneMappingExposure = options.toneMappingExposure;

  if (options.shadowMode === 'off') {
    renderer.shadowMap.enabled = false;
  } else {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type =
      options.shadowMode === 'soft'
        ? THREE.PCFSoftShadowMap
        : THREE.BasicShadowMap;
  }

  // Per-light map sizes are set in SceneLighting from LOD; store the renderer
  // contract size for diagnostics and tests.
  shadowMapSizeByRenderer.set(renderer, options.shadowMapSize);
}

/** Minimal scene surface the live quality update walks. */
export interface RendererQualityScene {
  traverse(callback: (object: unknown) => void): void;
}

interface MaybeMaterialHolder {
  material?: unknown;
}

function forEachMaterial(
  scene: RendererQualityScene,
  visit: (material: { needsUpdate: boolean }) => void
): void {
  scene.traverse((object) => {
    const material = (object as MaybeMaterialHolder)?.material;
    if (!material) return;
    if (Array.isArray(material)) {
      for (const entry of material) {
        if (entry) visit(entry as { needsUpdate: boolean });
      }
    } else {
      visit(material as { needsUpdate: boolean });
    }
  });
}

/** What `applyRendererQualityUpdate` actually changed on the renderer. */
export interface RendererQualityUpdateResult {
  shadowConfigChanged: boolean;
  toneMappingChanged: boolean;
}

/**
 * Re-apply the quality-derived renderer *properties* on a live renderer, without
 * recreating the WebGL context.
 *
 * The subtle part is shadow mode. `WebGLRenderer.shadowMap.type` is baked into
 * each material's compiled program as the `SHADOWMAP_TYPE_*` define, and three's
 * `needsProgramChange` check in `setProgram` does **not** include the shadow map
 * type — so flipping `basic` ↔ `soft` (or shadows on ↔ off) keeps rendering the
 * old program until every material is invalidated. `shadowMap.needsUpdate` only
 * re-renders the shadow *maps*; it does not recompile anything. Hence the scene
 * walk: it is what makes a mid-run `medium` → `high` switch actually look
 * different instead of only costing more.
 *
 * Pass the scene whenever one is available; omitting it skips the recompile and
 * is only correct when nothing has been rendered yet.
 */
export function applyRendererQualityUpdate(
  renderer: RendererContextTarget & { shadowMap: { needsUpdate?: boolean } },
  options: RendererContextOptions,
  scene?: RendererQualityScene
): RendererQualityUpdateResult {
  const previousShadowEnabled = renderer.shadowMap.enabled;
  const previousShadowType = renderer.shadowMap.type;
  const previousToneMapping = renderer.toneMapping;
  const previousExposure = renderer.toneMappingExposure;
  const previousColorSpace = renderer.outputColorSpace;

  applyRendererContextOptions(renderer, options);

  const shadowConfigChanged =
    previousShadowEnabled !== renderer.shadowMap.enabled ||
    previousShadowType !== renderer.shadowMap.type;
  const toneMappingChanged =
    previousToneMapping !== renderer.toneMapping ||
    previousExposure !== renderer.toneMappingExposure ||
    previousColorSpace !== renderer.outputColorSpace;

  if (shadowConfigChanged) {
    renderer.shadowMap.needsUpdate = true;
  }

  if ((shadowConfigChanged || toneMappingChanged) && scene) {
    forEachMaterial(scene, (material) => {
      material.needsUpdate = true;
    });
  }

  return { shadowConfigChanged, toneMappingChanged };
}
