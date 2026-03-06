import * as THREE from 'three';

/**
 * RiverShader - Safe property-based wetness and moss effects
 *
 * GLSL injection via onBeforeCompile was previously disabled due to shader
 * compilation errors (THREE.WebGLProgram VALIDATE_STATUS false).
 * This version uses material property tweaks only — no shader injection —
 * so it is guaranteed to be stable.
 *
 * Effects applied:
 *   - Wetness: slightly darker colour, reduced roughness (wet surfaces reflect more)
 *   - Moss tint: subtle green shift for surfaces near water
 *
 * To re-enable full GLSL caustic / wetness injection in the future, wrap the
 * onBeforeCompile block in a try/catch and gate it behind a feature flag.
 */

// Wet stone absorbs ~18% more light than dry stone (Hapke reflectance model approx)
const WETNESS_DARKEN_FACTOR = 0.82;
// Damp surfaces near running water have lower roughness (higher specular reflection)
const WETNESS_ROUGHNESS_REDUCTION = 0.25;
// Moss tint: desaturated green-grey matching lichened creek stone
const MOSS_TINT = new THREE.Color('#607860');
const MOSS_BLEND = 0.12; // 12% blend toward moss keeps the effect subtle

export function extendRiverMaterial(material) {
    if (!material) return;
    try {
        if (material.color) {
            material.color.multiplyScalar(WETNESS_DARKEN_FACTOR);
        }
        if (material.roughness !== undefined) {
            material.roughness = Math.max(0.25, material.roughness - WETNESS_ROUGHNESS_REDUCTION);
        }
        if (material.color) {
            material.color.lerp(MOSS_TINT, MOSS_BLEND);
        }
        material.needsUpdate = true;
    } catch (e) {
        // Silently ignore any unexpected errors — visual enrichment only
    }
}
