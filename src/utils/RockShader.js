import * as THREE from 'three';

/**
 * RockShader - Procedural geological detail for instanced decor rocks (boulders,
 * slabs, columns, scree, pebbles). Uses shader injection via onBeforeCompile,
 * following the same pattern as RiverShader.js / TreeShader.js.
 *
 * Everything here is derived purely from world position + world normal, so it
 * needs no extra geometry attributes and works unchanged across instancing.
 *
 * Effects (each independently tunable per material instance via `options`,
 * which lets a single shared geometry/shader express different "geological
 * personalities" — river-worn boulders, sedimentary slabs, fractured columns):
 *   - Moss/lichen on upward-facing surfaces near the waterline
 *   - Iron-oxide / water-staining drip streaks (fbm-driven)
 *   - Sedimentary stratification bands (horizontal color banding)
 *   - Dust/sand accumulation on upward-facing low-slope surfaces
 *   - Wetness darkening + roughness reduction near the waterline
 *   - Fresnel rim/edge lighting to read silhouettes at speed
 *
 * A per-instance seed is derived from the resolved diffuse color (instance
 * color x vertex color), so streaks/dust phase vary per instance without any
 * additional attributes.
 */

function injectShaderChunk(source, marker, replacement, label) {
    if (!source.includes(marker)) {
        throw new Error(`RockShader: Missing shader marker "${marker}" in ${label}`);
    }
    return source.replace(marker, replacement);
}

export function extendRockMaterial(material, options = {}) {
    if (!material) return material;

    const {
        waterLevel = 0.5,
        mossStrength = 0.4,
        mossColor = '#3f5c2a',
        lichenColor = '#9aa66b',
        streakStrength = 0.3,
        streakColor = '#5a3322',
        bandStrength = 0.0,
        bandScale = 2.4,
        dustStrength = 0.2,
        dustColor = '#cdbf9a',
        wetnessRange = 2.5,
        rimStrength = 0.25,
        rimColor = '#cfe6ff',
    } = options;

    try {
        material.onBeforeCompile = (shader) => {
            try {
                shader.uniforms.uWaterLevel = { value: waterLevel };
                shader.uniforms.uMossStrength = { value: mossStrength };
                shader.uniforms.uMossColor = { value: new THREE.Color(mossColor) };
                shader.uniforms.uLichenColor = { value: new THREE.Color(lichenColor) };
                shader.uniforms.uStreakStrength = { value: streakStrength };
                shader.uniforms.uStreakColor = { value: new THREE.Color(streakColor) };
                shader.uniforms.uBandStrength = { value: bandStrength };
                shader.uniforms.uBandScale = { value: bandScale };
                shader.uniforms.uDustStrength = { value: dustStrength };
                shader.uniforms.uDustColor = { value: new THREE.Color(dustColor) };
                shader.uniforms.uWetnessRange = { value: wetnessRange };
                shader.uniforms.uRimStrength = { value: rimStrength };
                shader.uniforms.uRimColor = { value: new THREE.Color(rimColor) };

                const vertexPreamble = [
                    'varying vec3 vRockWorldPos;',
                    'varying vec3 vRockNormal;',
                ].join('\n') + '\n';

                shader.vertexShader = injectShaderChunk(
                    vertexPreamble + shader.vertexShader,
                    '#include <beginnormal_vertex>',
                    `
                #include <beginnormal_vertex>

                #ifdef USE_INSTANCING
                    vec3 rockObjNormal = mat3(instanceMatrix) * objectNormal;
                #else
                    vec3 rockObjNormal = objectNormal;
                #endif
                vRockNormal = normalize((modelMatrix * vec4(rockObjNormal, 0.0)).xyz);
                `,
                    'vertex shader normal'
                );

                shader.vertexShader = injectShaderChunk(
                    shader.vertexShader,
                    '#include <begin_vertex>',
                    `
                #include <begin_vertex>

                vec4 rockVertex = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                    rockVertex = instanceMatrix * rockVertex;
                #endif
                vRockWorldPos = (modelMatrix * rockVertex).xyz;
                `,
                    'vertex shader position'
                );

                const fragmentPreamble = [
                    'varying vec3 vRockWorldPos;',
                    'varying vec3 vRockNormal;',
                    'uniform float uWaterLevel;',
                    'uniform float uMossStrength;',
                    'uniform vec3 uMossColor;',
                    'uniform vec3 uLichenColor;',
                    'uniform float uStreakStrength;',
                    'uniform vec3 uStreakColor;',
                    'uniform float uBandStrength;',
                    'uniform float uBandScale;',
                    'uniform float uDustStrength;',
                    'uniform vec3 uDustColor;',
                    'uniform float uWetnessRange;',
                    'uniform float uRimStrength;',
                    'uniform vec3 uRimColor;',
                    `
                float rockHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float rockNoise(vec2 p) {
                    vec2 i = floor(p); vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(rockHash(i), rockHash(i + vec2(1.0, 0.0)), f.x),
                               mix(rockHash(i + vec2(0.0, 1.0)), rockHash(i + vec2(1.0, 1.0)), f.x), f.y);
                }
                float rockFbm(vec2 p) {
                    float value = 0.0;
                    float amp = 0.5;
                    for (int i = 0; i < 3; i++) {
                        value += rockNoise(p) * amp;
                        p *= 2.02;
                        amp *= 0.5;
                    }
                    return value;
                }
                `,
                ].join('\n') + '\n';

                shader.fragmentShader = injectShaderChunk(
                    fragmentPreamble + shader.fragmentShader,
                    '#include <color_fragment>',
                    `
                #include <color_fragment>

                {
                    vec3 N = normalize(vRockNormal);
                    float heightAboveWater = vRockWorldPos.y - uWaterLevel;
                    float upFacing = clamp(dot(N, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);

                    // Per-instance seed from the resolved color, so streaks/dust
                    // vary per rock without extra attributes.
                    float instSeed = dot(diffuseColor.rgb, vec3(12.9898, 78.233, 37.719));
                    instSeed = fract(sin(instSeed) * 43758.5453);

                    // Moss/lichen on upward faces near the waterline
                    if (uMossStrength > 0.001) {
                        float mossNoise = rockFbm(vRockWorldPos.xz * 0.6 + instSeed * 10.0);
                        float mossBand = 1.0 - smoothstep(0.0, 4.0, max(heightAboveWater, 0.0));
                        float mossMask = upFacing * mossBand * smoothstep(0.25, 0.75, mossNoise);
                        vec3 growth = mix(uMossColor, uLichenColor, mossNoise);
                        diffuseColor.rgb = mix(diffuseColor.rgb, growth, mossMask * uMossStrength);
                    }

                    // Iron-oxide / water-staining drip streaks
                    if (uStreakStrength > 0.001) {
                        vec2 streakP = vec2(vRockWorldPos.x * 3.0 + instSeed * 20.0, vRockWorldPos.y * 0.6);
                        float streak = rockFbm(streakP);
                        float streakMask = smoothstep(0.55, 0.85, streak) * (1.0 - upFacing * 0.6);
                        diffuseColor.rgb = mix(diffuseColor.rgb, uStreakColor, streakMask * uStreakStrength);
                    }

                    // Sedimentary stratification bands
                    if (uBandStrength > 0.001) {
                        float bandWarp = rockFbm(vRockWorldPos.xz * 0.4 + instSeed * 5.0);
                        float band = sin(vRockWorldPos.y * uBandScale + bandWarp * 3.0) * 0.5 + 0.5;
                        float bandContrast = smoothstep(0.2, 0.8, band);
                        diffuseColor.rgb *= mix(0.82, 1.12, bandContrast * uBandStrength + (1.0 - uBandStrength) * 0.5);
                    }

                    // Dust/sand accumulation on flat upward-facing surfaces
                    if (uDustStrength > 0.001) {
                        float dustNoise = rockFbm(vRockWorldPos.xz * 1.4 - instSeed * 8.0);
                        float dustMask = upFacing * smoothstep(0.3, 0.9, dustNoise);
                        diffuseColor.rgb = mix(diffuseColor.rgb, uDustColor, dustMask * uDustStrength * 0.5);
                    }

                    // Wetness near the waterline: darken
                    float wetness = 1.0 - smoothstep(0.0, uWetnessRange, abs(heightAboveWater));
                    diffuseColor.rgb *= 1.0 - wetness * 0.32;
                }
                `,
                    'fragment shader color'
                );

                shader.fragmentShader = injectShaderChunk(
                    shader.fragmentShader,
                    '#include <emissivemap_fragment>',
                    `
                #include <emissivemap_fragment>

                // Fresnel rim/edge lighting so silhouettes read at speed
                float rockFresnel = pow(1.0 - max(dot(normalize(vRockNormal), normalize(vViewPosition)), 0.0), 3.0);
                totalEmissiveRadiance += uRimColor * rockFresnel * uRimStrength;
                `,
                    'fragment shader emissive'
                );

                if (shader.fragmentShader.includes('#include <roughnessmap_fragment>')) {
                    shader.fragmentShader = injectShaderChunk(
                        shader.fragmentShader,
                        '#include <roughnessmap_fragment>',
                        `
                    #include <roughnessmap_fragment>
                    float rockHeightAboveWater = vRockWorldPos.y - uWaterLevel;
                    float rockWetness = 1.0 - smoothstep(0.0, uWetnessRange, abs(rockHeightAboveWater));
                    roughnessFactor *= 1.0 - rockWetness * 0.4;
                    `,
                        'fragment shader roughness'
                    );
                }

                material.userData.rockShader = shader;
                material.userData.rockShaderFailed = false;
            } catch (error) {
                material.userData.rockShader = null;
                material.userData.rockShaderFailed = true;
                console.error('RockShader: Error compiling shader injection:', error);
            }
        };

        material.needsUpdate = true;
    } catch (e) {
        console.warn('RockShader: Error setting up shader injection:', e);
    }

    return material;
}
