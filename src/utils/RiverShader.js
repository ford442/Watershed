import * as THREE from 'three';
import { WALL_WATERLINE_Y, SHADERS } from '../constants/game';

/**
 * RiverShader - Enhanced wetness, moss, and triplanar texture effects
 *
 * This version uses shader injection via onBeforeCompile for:
 *   - Wetness: Darkens surfaces near water (Y=13), reduces roughness
 *   - Moss/Lichen: Uses vertex color mossMask for organic growth bands
 *   - Triplanar blending: Mixes primary and secondary UVs for texture variety
 *
 * Effects are driven by vertex attributes:
 *   - color: Base vertex colors with gradient from waterline to rim
 *   - mossMask: 0-1 mask for moss/lichen intensity
 *   - uv2: Secondary triplanar UV coordinates
 */

// Wetness parameters
const WETNESS_DARKEN_FACTOR = 0.75;
const WETNESS_ROUGHNESS_REDUCTION = 0.30;
const WATER_LEVEL_Y = WALL_WATERLINE_Y;
const WETNESS_RANGE = 4.0;

// Moss/Lichen colors
const MOSS_COLOR = new THREE.Color(SHADERS.MOSS_COLOR);      // Deep moss green
const LICHEN_COLOR = new THREE.Color(SHADERS.LICHEN_COLOR);    // Lighter lichen
const MOSS_INTENSITY = 0.6;

function injectShaderChunk(source, marker, replacement, label) {
    if (!source.includes(marker)) {
        throw new Error(`RiverShader: Missing shader marker "${marker}" in ${label}`);
    }

    return source.replace(marker, replacement);
}

/**
 * Extends a material with river-aware shader effects
 * @param {THREE.Material} material - The material to extend
 * @param {Object} options - Optional configuration
 */
export function extendRiverMaterial(material, options = {}) {
    if (!material) return;

    const {
        enableWetness = true,
        enableMoss = true,
        enableTriplanar = true,
        waterLevel = WATER_LEVEL_Y,
        wetnessRange = WETNESS_RANGE
    } = options;

    try {
        // Store shader reference for updates
        material.userData.riverShader = {
            waterLevel,
            wetnessRange,
            time: 0
        };

        material.onBeforeCompile = (shader) => {
            try {
                shader.uniforms.uWaterLevel = { value: waterLevel };
                shader.uniforms.uWetnessRange = { value: wetnessRange };
                shader.uniforms.uTime = { value: 0 };
                if (enableMoss) {
                    shader.uniforms.uMossColor = { value: MOSS_COLOR };
                    shader.uniforms.uLichenColor = { value: LICHEN_COLOR };
                    shader.uniforms.uMossIntensity = { value: MOSS_INTENSITY };
                }

                // Build vertex shader preamble conditionally to avoid declaring
                // attributes that are not present on every geometry.
                const vertexPreamble = [
                    enableMoss ? 'attribute float mossMask;' : '',
                    // Only declare custom uv2 attribute when triplanar blending is
                    // active and Three.js is not already using its own second UV
                    // channel (USE_AOMAP / USE_LIGHTMAP both reserve uv1 in r152+).
                    enableTriplanar ? `
                #if !defined( USE_LIGHTMAP ) && !defined( USE_AOMAP )
                attribute vec2 uv2;
                varying vec2 vUv2;
                #endif` : '',
                    enableMoss ? 'varying float vMossMask;' : '',
                    'varying float vHeightAboveWater;',
                    'varying vec3 vWorldPos;',
                    'uniform float uWaterLevel;',
                ].filter(Boolean).join('\n') + '\n';

                const nextVertexShader = injectShaderChunk(
                    vertexPreamble + shader.vertexShader,
                    '#include <begin_vertex>',
                    `
                #include <begin_vertex>
                
                // Calculate height above water for wetness / moss gradients
                vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                vHeightAboveWater = vWorldPos.y - uWaterLevel;
                
                ${enableMoss ? 'vMossMask = mossMask;' : ''}
                ${enableTriplanar ? `
                #if !defined( USE_LIGHTMAP ) && !defined( USE_AOMAP )
                vUv2 = uv2;
                #endif` : ''}
                `,
                    'vertex shader'
                );

                // Build fragment shader preamble conditionally.
                const fragmentPreamble = [
                    'uniform float uWaterLevel;',
                    'uniform float uWetnessRange;',
                    'uniform float uTime;',
                    enableMoss ? 'uniform vec3 uMossColor;' : '',
                    enableMoss ? 'uniform vec3 uLichenColor;' : '',
                    enableMoss ? 'uniform float uMossIntensity;' : '',
                    'varying float vHeightAboveWater;',
                    enableMoss ? 'varying float vMossMask;' : '',
                    enableTriplanar ? `
                #if !defined( USE_LIGHTMAP ) && !defined( USE_AOMAP )
                varying vec2 vUv2;
                #endif` : '',
                    'varying vec3 vWorldPos;',
                    enableMoss ? `
                // Noise helper for organic moss variation
                float riverNoise(vec2 p) {
                    return sin(p.x * 3.0) * sin(p.y * 3.0) * 0.5 + 0.5;
                }` : '',
                ].filter(Boolean).join('\n') + '\n';

                // Replace map_fragment entirely so the texture is applied exactly
                // once.  When triplanar blending is active we mix a secondary UV
                // sample (vUv2) with the standard UV sample based on height above
                // the waterline.  When it is inactive we reproduce the standard
                // Three.js map_fragment behaviour without the extra sample.
                const mapFragmentReplacement = `
                #ifdef USE_MAP
                    vec4 sampledDiffuseColor = texture2D( map, vMapUv );
                    #ifdef DECODE_VIDEO_TEXTURE
                        // sRGB EOTF (Electro-Optical Transfer Function) constants from
                        // Three.js map_fragment chunk – decode video textures from sRGB.
                        sampledDiffuseColor = vec4( mix(
                            pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ),
                            sampledDiffuseColor.rgb * 0.0773993808,
                            vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) )
                        ), sampledDiffuseColor.w );
                    #endif
                    ${enableTriplanar ? `
                    #if !defined( USE_LIGHTMAP ) && !defined( USE_AOMAP )
                        // Triplanar blend: waterline uses secondary UV, rim uses standard UV
                        vec4 triplanarSample = texture2D( map, vUv2 );
                        float triplanarBlend = smoothstep( 0.0, 8.0, vHeightAboveWater );
                        sampledDiffuseColor = mix( triplanarSample, sampledDiffuseColor, triplanarBlend * 0.6 + 0.2 );
                    #endif` : ''}
                    diffuseColor *= sampledDiffuseColor;
                #endif
                `;

                const nextFragmentShader = injectShaderChunk(
                    injectShaderChunk(
                        fragmentPreamble + shader.fragmentShader,
                        '#include <map_fragment>',
                        mapFragmentReplacement,
                        'fragment shader'
                    ),
                    '#include <color_fragment>',
                    `
                #include <color_fragment>
                
                ${enableMoss ? `
                // Moss/Lichen bands using vertex color mask
                if (vMossMask > 0.1) {
                    // Organic variation based on world position
                    float mossNoise = riverNoise(vWorldPos.xz * 0.5 + uTime * 0.05);
                    float mossNoise2 = riverNoise(vWorldPos.xz * 1.2 - uTime * 0.03);
                    
                    // Blend between moss and lichen based on height
                    float heightFactor = smoothstep(0.0, 3.0, vHeightAboveWater);
                    vec3 growthColor = mix(uMossColor, uLichenColor, heightFactor);
                    
                    // Modulate intensity with noise
                    float intensity = vMossMask * uMossIntensity * (0.7 + mossNoise * 0.3);
                    intensity *= (0.8 + mossNoise2 * 0.2);
                    
                    // Apply moss color
                    diffuseColor.rgb = mix(diffuseColor.rgb, growthColor, intensity);
                }
                ` : ''}
                
                ${enableWetness ? `
                // Wetness effect - darker near waterline
                float wetnessFactor = 1.0 - smoothstep(0.0, uWetnessRange, vHeightAboveWater);
                wetnessFactor = clamp(wetnessFactor, 0.0, 1.0);
                
                // Darken wet areas
                float wetDarken = 1.0 - (wetnessFactor * (1.0 - ${WETNESS_DARKEN_FACTOR.toFixed(2)}));
                diffuseColor.rgb *= wetDarken;
                ` : ''}
                `,
                    'fragment shader'
                );

                shader.vertexShader = nextVertexShader;
                shader.fragmentShader = nextFragmentShader;
                material.userData.shader = shader;
                material.userData.shaderFailed = false;
            } catch (error) {
                material.userData.shader = null;
                material.userData.shaderFailed = true;
                console.error('RiverShader: Error compiling shader injection:', error);
                console.error('RiverShader: Vertex shader:', shader?.vertexShader?.substring?.(0, 500));
                console.error('RiverShader: Fragment shader:', shader?.fragmentShader?.substring?.(0, 500));
                fallbackExtend(material);
            }
        };

        // Mark material for updates
        material.needsUpdate = true;

    } catch (e) {
        console.warn('RiverShader: Error setting up shader injection:', e);
        // Fallback to property-based approach
        fallbackExtend(material);
    }
}

/**
 * Fallback property-based material extension
 */
function fallbackExtend(material) {
    try {
        if (material.color) {
            material.color.multiplyScalar(WETNESS_DARKEN_FACTOR);
        }
        if (material.roughness !== undefined) {
            material.roughness = Math.max(0.25, material.roughness - WETNESS_ROUGHNESS_REDUCTION);
        }
        material.needsUpdate = true;
    } catch (e) {
        // Silently ignore
    }
}

/**
 * Update shader uniforms (call in useFrame)
 * @param {THREE.Material} material - The material to update
 * @param {number} time - Current elapsed time
 * @param {number} waterLevel - Optional water level override
 */
export function updateRiverMaterial(material, time, waterLevel) {
    if (!material || !material.userData.shader) return;

    const shader = material.userData.shader;
    if (shader.uniforms) {
        shader.uniforms.uTime.value = time;
        if (waterLevel !== undefined && shader.uniforms.uWaterLevel) {
            shader.uniforms.uWaterLevel.value = waterLevel;
        }
    }
}

/**
 * Create a river-aware material with all effects pre-configured
 * @param {Object} parameters - Base material parameters
 * @returns {THREE.MeshStandardMaterial}
 */
export function createRiverMaterial(parameters = {}) {
    const material = new THREE.MeshStandardMaterial({
        roughness: 0.9,
        metalness: 0.1,
        ...parameters
    });

    extendRiverMaterial(material);
    return material;
}
