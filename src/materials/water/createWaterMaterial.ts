/**
 * createWaterMaterial.ts — the water material host (Phase 0 of #256 path A).
 *
 * One call site (`FlowingWater`) asks for "a water material"; this factory decides
 * which implementation it gets and guarantees both look identical from the outside:
 * a `THREE.Material` plus a `uniforms` record keyed by `waterUniformSpec`.
 *
 * The TSL branch is defensive on purpose. The node module may not be loaded yet
 * (it is dynamically imported to keep `three/webgpu` out of the default bundle —
 * see nodeMaterials.ts), and building a node graph can throw on a three version
 * whose TSL surface has drifted. A throw here would take the whole Canvas down,
 * so any failure degrades to the legacy GLSL material and reports the backend it
 * actually produced. Callers should read `handle.backend`, not the requested one.
 */

import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import { getLoadedNodeMaterials } from '../nodeMaterials';
import type { WaterNodeMaterial } from './WaterNodeMaterial';
import { createGlslWaterUniforms, type WaterUniformInit, type WaterUniformName } from './waterUniformSpec';

export interface WaterGlslSource {
  vertexShader: string;
  fragmentShader: string;
  defines: Record<string, string>;
}

export interface WaterMaterialRequest {
  backend: MaterialBackend;
  init: WaterUniformInit;
  /** GLSL sources — required, since TSL failures fall back to them. */
  glsl: WaterGlslSource;
}

export interface WaterMaterialHandle {
  material: THREE.ShaderMaterial | WaterNodeMaterial;
  /** The backend actually produced, which may differ from the one requested. */
  backend: MaterialBackend;
  uniforms: Record<WaterUniformName, { value: unknown }>;
  /** Set when a requested TSL material could not be built. */
  fallbackReason?: string;
}

let warnedTslFailure = false;

function createGlslWaterMaterial(request: WaterMaterialRequest): WaterMaterialHandle {
  const uniforms = createGlslWaterUniforms(request.init);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    defines: request.glsl.defines,
    uniforms,
    vertexShader: request.glsl.vertexShader,
    fragmentShader: request.glsl.fragmentShader,
  });
  material.userData.materialBackend = 'glsl';
  return { material, backend: 'glsl', uniforms };
}

/**
 * Build the water material for the requested backend.
 *
 * @example
 *   const { material, backend } = createWaterMaterial({
 *     backend: resolveMaterialBackend().backend,
 *     init: { flowSpeed, waterColor, deepColor, foamColor, edgeHighlight },
 *     glsl: { vertexShader, fragmentShader, defines },
 *   });
 */
export function createWaterMaterial(request: WaterMaterialRequest): WaterMaterialHandle {
  if (request.backend === 'glsl') {
    return createGlslWaterMaterial(request);
  }

  const nodeMaterials = getLoadedNodeMaterials();
  if (!nodeMaterials) {
    return {
      ...createGlslWaterMaterial(request),
      fallbackReason: 'node material module not loaded',
    };
  }

  try {
    const material = nodeMaterials.water.createWaterNodeMaterial(request.init);
    return { material, backend: 'tsl', uniforms: material.uniforms };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!warnedTslFailure) {
      warnedTslFailure = true;
      console.warn(
        '[createWaterMaterial] TSL water material failed to build; falling back to GLSL. ' +
          'Report this with your three version — see docs/reference/RENDERER_CONTRACT.md.',
        error,
      );
    }
    return { ...createGlslWaterMaterial(request), fallbackReason: message };
  }
}

/** Test seam — resets the once-per-session warning. */
export function resetWaterMaterialWarnings(): void {
  warnedTslFailure = false;
}
