import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import { getLoadedNodeMaterials } from '../nodeMaterials';

const warned: Record<string, boolean> = {};

export function createDualVfxMaterial(
  backend: MaterialBackend,
  label: string,
  glslParams: THREE.ShaderMaterialParameters,
  tslBuild: () => THREE.Material,
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.vfx) {
    try {
      return tslBuild();
    } catch (error) {
      if (!warned[label]) {
        warned[label] = true;
        console.warn(`[${label}] TSL material failed to build; falling back to GLSL.`, error);
      }
    }
  }
  const material = new THREE.ShaderMaterial(glslParams);
  material.userData.materialBackend = 'glsl';
  return material;
}

export function resetVfxMaterialWarnings(): void {
  for (const key of Object.keys(warned)) delete warned[key];
}
