import * as THREE from 'three';

/** Uniform bag on a ShaderMaterial or on a TSL material's userData.uniforms. */
export function materialUniformBag(
  material: THREE.Material | null | undefined,
): Record<string, { value: unknown }> | undefined {
  if (!material) return undefined;
  const shader = material as THREE.ShaderMaterial;
  if (shader.uniforms && typeof shader.uniforms === 'object') return shader.uniforms;
  return material.userData.uniforms as Record<string, { value: unknown }> | undefined;
}
