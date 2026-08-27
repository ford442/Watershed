import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import { getLoadedNodeMaterials } from '../nodeMaterials';
import {
  extendTreeMaterial,
  updateTreeMaterial,
  type TreeShaderOptions,
} from '../../utils/TreeShader';
import {
  extendVegetationMaterial,
  updateVegetationMaterial,
  type VegetationShaderOptions,
} from '../../utils/VegetationShader';
import { extendRockMaterial, type RockShaderOptions } from '../../utils/RockShader';

const warned = { current: false };

export function createTreeSurfaceMaterial(
  backend: MaterialBackend,
  source: THREE.MeshStandardMaterial,
  options?: TreeShaderOptions,
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.foliage) {
    try {
      return nodes.foliage.createTreeNodeMaterial(source, options) as unknown as THREE.Material;
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createTreeSurfaceMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  extendTreeMaterial(source as never, options);
  return source;
}

export function updateTreeSurfaceMaterial(
  material: THREE.Material | null | undefined,
  time: number,
  playerPos?: THREE.Vector3,
): void {
  if (!material) return;
  const nodes = getLoadedNodeMaterials();
  if (material.userData.materialBackend === 'tsl' && nodes?.foliage) {
    nodes.foliage.updateTreeNodeMaterial(material, time, playerPos);
    return;
  }
  updateTreeMaterial(material as never, time, playerPos);
}

export function createVegetationSurfaceMaterial(
  backend: MaterialBackend,
  source: THREE.MeshStandardMaterial,
  options?: VegetationShaderOptions,
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.foliage) {
    try {
      return nodes.foliage.createVegetationNodeMaterial(source, options) as unknown as THREE.Material;
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createVegetationSurfaceMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  extendVegetationMaterial(source as never, options);
  return source;
}

export function updateVegetationSurfaceMaterial(
  material: THREE.Material | null | undefined,
  time: number,
  intensity = 1,
): void {
  if (!material) return;
  const nodes = getLoadedNodeMaterials();
  if (material.userData.materialBackend === 'tsl' && nodes?.foliage) {
    nodes.foliage.updateVegetationNodeMaterial(material, time, intensity);
    return;
  }
  updateVegetationMaterial(material as never, time, intensity);
}

export function createRockSurfaceMaterial(
  backend: MaterialBackend,
  source: THREE.Material,
  options?: RockShaderOptions,
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  const standard = (source as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? (source as THREE.MeshStandardMaterial)
    : null;
  if (backend === 'tsl' && nodes?.foliage && standard) {
    try {
      return nodes.foliage.createRockNodeMaterial(standard, options) as unknown as THREE.Material;
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createRockSurfaceMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  return extendRockMaterial(source, options) ?? source;
}

export function resetFoliageSurfaceWarnings(): void {
  warned.current = false;
}
