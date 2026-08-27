import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import { getLoadedNodeMaterials } from '../nodeMaterials';
import { createDualVfxMaterial } from './vfxDualFactory';

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
  return createDualVfxMaterial(
    backend,
    'createBackendShaderMaterial',
    params,
    () => nodes!.vfx.createGenericVfxNodeMaterial(params) as unknown as THREE.Material,
  );
}

export function resetBackendShaderWarnings(): void {
  // warnings live in vfxDualFactory
}
