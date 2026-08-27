import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import { getLoadedNodeMaterials } from '../nodeMaterials';

const warned = { current: false };

/**
 * Dual-path factory for leftover VFX ShaderMaterials. GLSL uses the provided
 * ShaderMaterialParameters; TSL uses a generic node stand-in that reads the
 * same uniform bag so useFrame updates keep working.
 */
export function createBackendShaderMaterial(
  backend: MaterialBackend,
  params: THREE.ShaderMaterialParameters,
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.vfx) {
    try {
      return nodes.vfx.createGenericVfxNodeMaterial(params) as unknown as THREE.Material;
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createBackendShaderMaterial] TSL VFX failed; falling back to GLSL.', error);
      }
    }
  }
  const material = new THREE.ShaderMaterial(params);
  material.userData.materialBackend = 'glsl';
  return material;
}

export function resetBackendShaderWarnings(): void {
  warned.current = false;
}
