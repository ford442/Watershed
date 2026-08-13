/**
 * createCanyonSurfaceMaterial.ts — slot-canyon material host (#256 path A, phase 2).
 *
 * Third and last of the hosts (water → river → canyon), and the one that wires up
 * the `CanyonNodeMaterial` seed. Same contract as the others: pick an
 * implementation, never throw, and dispatch per-frame updates on what was built.
 *
 * The GLSL side is a raw ShaderMaterial, which a node renderer cannot consume at
 * all (it logs `NodeMaterial: Material "ShaderMaterial" is not compatible`), so
 * routing this through the host is what keeps `?material=tsl` free of that error
 * on slot-canyon segments.
 */

import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import {
  createCanyonMaterial,
  updateCanyonMaterial,
  type CanyonMaterial,
  type CanyonMaterialOptions,
} from '../CanyonMaterial';
import { getLoadedNodeMaterials } from '../nodeMaterials';

export interface CanyonSurfaceUpdate {
  flowSpeed?: number;
  mossCoverage?: number;
  highWaterMark?: number;
  highWaterIntensity?: number;
}

let warnedTslFailure = false;

/** True when the material carries the TSL canyon uniform bag. */
export function isCanyonNodeSurface(material: THREE.Material | null | undefined): boolean {
  return !!material && !!(material.userData as { canyonUniforms?: unknown })?.canyonUniforms;
}

/** Build the slot-canyon wall material for the given backend. */
export function createCanyonSurfaceMaterial(
  backend: MaterialBackend,
  options: CanyonMaterialOptions = {},
): THREE.Material {
  const nodeMaterials = getLoadedNodeMaterials();

  if (backend === 'tsl' && nodeMaterials) {
    try {
      return nodeMaterials.canyon.createCanyonNodeMaterial(options) as unknown as THREE.Material;
    } catch (error) {
      if (!warnedTslFailure) {
        warnedTslFailure = true;
        console.warn(
          '[createCanyonSurfaceMaterial] TSL canyon material failed to build; falling back to GLSL.',
          error,
        );
      }
    }
  }

  return createCanyonMaterial(options);
}

/** Per-frame uniform update, dispatched by material kind. */
export function updateCanyonSurfaceMaterial(
  material: THREE.Material | null | undefined,
  update: CanyonSurfaceUpdate,
  elapsedTime: number,
): void {
  if (!material) return;

  const nodeMaterials = getLoadedNodeMaterials();
  if (nodeMaterials && isCanyonNodeSurface(material)) {
    nodeMaterials.canyon.updateCanyonNodeMaterial(material as never, update, elapsedTime);
    return;
  }

  updateCanyonMaterial(material as CanyonMaterial, update, elapsedTime);
}

/** Test seam — resets the once-per-session warning. */
export function resetCanyonSurfaceWarnings(): void {
  warnedTslFailure = false;
}
