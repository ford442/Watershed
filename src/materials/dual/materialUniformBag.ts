import * as THREE from 'three';

/** Uniform bag on a ShaderMaterial or on a TSL material's userData.uniforms. */
export function materialUniformBag(
  material: THREE.Material | THREE.Material[] | null | undefined,
): Record<string, { value: unknown }> | undefined {
  if (!material) return undefined;
  const first = Array.isArray(material) ? material[0] : material;
  if (!first) return undefined;
  const shader = first as THREE.ShaderMaterial;
  if (shader.uniforms && typeof shader.uniforms === 'object') return shader.uniforms;
  return first.userData.uniforms as Record<string, { value: unknown }> | undefined;
}
