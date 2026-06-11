import * as THREE from 'three';

/**
 * VegetationShader - cheap per-vertex wind animation for instanced foliage.
 *
 * Instead of swaying an entire clump as one rigid group, this injects a
 * vertex-shader offset that:
 *  - reads each instance's world position from `instanceMatrix` to give every
 *    blade/stalk/petal its own phase (no two plants move identically), and
 *  - weights the offset by the vertex's local height (`transformed.y`), so the
 *    base of a blade/stem stays planted while the tip dances.
 *
 * Two modes:
 *  - 'blade' (default): lateral sway, scaled by height-from-ground.
 *  - 'bob': gentle vertical bob + drift, used for flat things like lily pads.
 */
export function extendVegetationMaterial(material, options = {}) {
    if (!material) return;

    const {
        plantHeight = 1.0,
        windStrength = 0.06,
        windSpeed = 1.4,
        mode = 'blade',
    } = options;

    material.userData.vegetationShader = { plantHeight, windStrength, windSpeed, mode };

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uWindStrength = { value: windStrength };
        shader.uniforms.uWindSpeed = { value: windSpeed };
        shader.uniforms.uPlantHeight = { value: plantHeight };

        const defines = mode === 'bob' ? '#define VEG_BOB\n' : '';

        shader.vertexShader = defines + `
uniform float uTime;
uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uPlantHeight;
` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
#include <begin_vertex>

#ifdef USE_INSTANCING
    vec3 vegInstancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
    vec3 vegInstancePos = vec3(0.0);
#endif

float vegWindPhase = vegInstancePos.x * 0.9 + vegInstancePos.z * 1.4;

#ifdef VEG_BOB
    float vegBob = sin(uTime * uWindSpeed * 0.6 + vegWindPhase) * uWindStrength;
    transformed.y += vegBob;
    transformed.x += sin(uTime * uWindSpeed * 0.4 + vegWindPhase * 1.3) * uWindStrength * 0.4;
    transformed.z += cos(uTime * uWindSpeed * 0.5 + vegWindPhase * 0.9) * uWindStrength * 0.4;
#else
    float vegHeightWeight = clamp(transformed.y / max(uPlantHeight, 0.0001), 0.0, 1.0);
    vegHeightWeight *= vegHeightWeight;
    float vegSway = sin(uTime * uWindSpeed + vegWindPhase) * uWindStrength;
    float vegSway2 = sin(uTime * uWindSpeed * 2.3 + vegWindPhase * 1.7 + transformed.x * 2.0) * uWindStrength * 0.35;
    transformed.x += (vegSway + vegSway2) * vegHeightWeight;
    transformed.z += cos(uTime * uWindSpeed * 0.8 + vegWindPhase * 0.6) * uWindStrength * 0.5 * vegHeightWeight;
#endif
`
        );

        material.userData.shader = shader;
    };

    material.needsUpdate = true;
}

/**
 * Update wind uniforms each frame.
 * @param {THREE.Material} material
 * @param {number} time - elapsed time
 * @param {number} intensity - 0-1 multiplier (e.g. weather gust strength)
 */
export function updateVegetationMaterial(material, time, intensity = 1) {
    if (!material?.userData?.shader) return;
    const shader = material.userData.shader;
    const base = material.userData.vegetationShader || {};
    if (shader.uniforms.uTime) shader.uniforms.uTime.value = time;
    if (shader.uniforms.uWindStrength) {
        shader.uniforms.uWindStrength.value = (base.windStrength ?? 0.06) * intensity;
    }
}

export default extendVegetationMaterial;
