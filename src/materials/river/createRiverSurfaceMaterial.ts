/**
 * createRiverSurfaceMaterial.ts — the canyon/rock material host (#256 path A, phase 2).
 *
 * Same shape as the water host: one call site asks for "a river-aware surface",
 * and this decides between the legacy GLSL injection and the TSL node graph.
 *
 *   glsl — `extendRiverMaterial()` patches a MeshStandardMaterial through
 *          `onBeforeCompile`. Only the classic WebGLRenderer honours that hook.
 *   tsl  — `copyStandardPropsToRiverMaterial()` rebuilds the same wetness / moss /
 *          triplanar / stratification math as a MeshStandardNodeMaterial. This
 *          wires up the previously dormant RiverNodeMaterial seed.
 *
 * Update calls dispatch on what the material actually is, so a caller's per-frame
 * loop is a single `updateRiverSurfaceMaterial(...)` regardless of backend.
 */

import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import { extendRiverMaterial, updateRiverMaterial } from '../../utils/RiverShader';
import { getLoadedNodeMaterials } from '../nodeMaterials';

export interface RiverSurfaceOptions {
  enableWetness?: boolean;
  enableMoss?: boolean;
  enableTriplanar?: boolean;
  waterLevel?: number;
  wetnessRange?: number;
}

export interface RiverSurfaceUpdate {
  waterLevel?: number;
  weatherWetness?: number;
}

let warnedTslFailure = false;

/**
 * True when the material carries the TSL river uniform bag. The GLSL path stores
 * `userData.shader` instead, so the two are unambiguous.
 */
export function isRiverNodeSurface(material: THREE.Material | null | undefined): boolean {
  return !!material && !!(material.userData as { riverUniforms?: unknown })?.riverUniforms;
}

/**
 * Build a river-aware surface material for the given backend.
 *
 * The GLSL branch mutates and returns the material it was handed (call sites
 * already pass `.clone()`); the TSL branch returns a NEW node material built from
 * the source's texture/color properties, leaving the source untouched.
 *
 * A non-standard source material (Basic/Phong/ShaderMaterial) has no node
 * equivalent here, so it stays on the GLSL path even when TSL is requested.
 */
export function createRiverSurfaceMaterial(
  backend: MaterialBackend,
  source: THREE.Material,
  options: RiverSurfaceOptions = {},
): THREE.Material {
  const standardSource = (source as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? (source as THREE.MeshStandardMaterial)
    : null;

  const nodeMaterials = getLoadedNodeMaterials();

  if (backend === 'tsl' && standardSource && nodeMaterials) {
    try {
      return nodeMaterials.river.copyStandardPropsToRiverMaterial(
        standardSource,
        options,
      ) as unknown as THREE.Material;
    } catch (error) {
      if (!warnedTslFailure) {
        warnedTslFailure = true;
        console.warn(
          '[createRiverSurfaceMaterial] TSL river material failed to build; falling back to GLSL.',
          error,
        );
      }
    }
  }

  return extendRiverMaterial(source, options);
}

/** Per-frame uniform update, dispatched by material kind. */
export function updateRiverSurfaceMaterial(
  material: THREE.Material | null | undefined,
  time: number,
  options: RiverSurfaceUpdate | number = {},
): void {
  if (!material) return;

  const nodeMaterials = getLoadedNodeMaterials();
  if (nodeMaterials && isRiverNodeSurface(material)) {
    nodeMaterials.river.updateRiverNodeMaterial(material as never, time, options);
    return;
  }

  updateRiverMaterial(material, time, options);
}

/** Test seam — resets the once-per-session warning. */
export function resetRiverSurfaceWarnings(): void {
  warnedTslFailure = false;
}
