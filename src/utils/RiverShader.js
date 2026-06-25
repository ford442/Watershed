/**
 * RiverShader facade — factory API backed by RiverNodeMaterial (TSL / NodeMaterial).
 */
import * as THREE from 'three';
import {
  createRiverNodeMaterial,
  copyStandardPropsToRiverMaterial,
  updateRiverNodeMaterial,
} from '../materials/RiverNodeMaterial';

export { MOSS_HEIGHT_FADE, MOSS_NORMAL_MASK, mossNormalFactor } from '../materials/tsl/riverConstants';

/**
 * Create a new river-aware NodeMaterial (does not mutate the input).
 */
export function extendRiverMaterial(material, options = {}) {
  if (!material) return material;

  if (material.isNodeMaterial && material.userData?.riverUniforms) {
    return material;
  }

  if (material.isMeshStandardMaterial || material instanceof THREE.MeshStandardMaterial) {
    return copyStandardPropsToRiverMaterial(material, options);
  }

  return createRiverNodeMaterial(
    {
      color: material.color?.clone?.() ?? new THREE.Color('#888880'),
      roughness: material.roughness ?? 0.9,
      metalness: material.metalness ?? 0.1,
      map: material.map ?? undefined,
      normalMap: material.normalMap ?? undefined,
      roughnessMap: material.roughnessMap ?? undefined,
      aoMap: material.aoMap ?? undefined,
      displacementMap: material.displacementMap ?? undefined,
      vertexColors: material.vertexColors ?? false,
      side: material.side,
    },
    options
  );
}

/**
 * Update river material uniform nodes (call in useFrame).
 */
export function updateRiverMaterial(material, time, options = {}) {
  if (!material) return;
  updateRiverNodeMaterial(material, time, options);
}

/**
 * Create a river-aware material with all effects pre-configured.
 */
export function createRiverMaterial(parameters = {}, options = {}) {
  return createRiverNodeMaterial(
    {
      roughness: 0.9,
      metalness: 0.1,
      ...parameters,
    },
    options
  );
}
