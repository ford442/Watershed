import * as THREE from 'three';
import { WALL_WATERLINE_Y, SHADERS, ROCK_SHADER } from '../constants/game';

/**
 * RiverShader - Enhanced wetness, moss, triplanar texture, parallax, cracks, and weather effects
 *
 * This version uses shader injection via onBeforeCompile for:
 *   - Wetness: Darkens surfaces near water (Y=13), reduces roughness
 *   - Weather wetness: Shares uWeatherWetness with the water shader for seamless blending
 *   - Moss/Lichen: Uses vertex color mossMask for organic growth bands, faded by height
 *   - Triplanar blending: Mixes primary and secondary UVs for texture variety
 *   - Cheap parallax offset: Uses displacement map for depth on near walls
 *   - Procedural cracks: FBM-based dark fissures
 *   - Stratification & color variation: Horizontal bands and height-based tint (secondary)
 *
 * Effects are driven by vertex attributes:
 *   - color: Base vertex colors with gradient from waterline to rim
 *   - mossMask: 0-1 mask for moss/lichen intensity
 *   - uv2: Secondary triplanar UV coordinates
 */

// Wetness parameters
const WETNESS_DARKEN_FACTOR = 0.70; // aligns with ROCK_SHADER.WETNESS_DARKEN = 0.30
const WETNESS_ROUGHNESS_REDUCTION = 0.30;
const WATER_LEVEL_Y = WALL_WATERLINE_Y;
const WETNESS_RANGE = 4.0;

// Moss/Lichen colors
const MOSS_COLOR = new THREE.Color(SHADERS.MOSS_COLOR);      // Deep moss green
const LICHEN_COLOR = new THREE.Color(SHADERS.LICHEN_COLOR);    // Lighter lichen
const MOSS_INTENSITY = 0.6;

// Shared 1x1 white texture for missing displacement maps
const WHITE_TEXTURE = (() => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
})();

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
                shader.uniforms.uWeatherWetness = { value: 0 };
                shader.uniforms.uDisplacementMap = { value: material.displacementMap || WHITE_TEXTURE };
                shader.uniforms.uDisplacementScale = { value: ROCK_SHADER.DISPLACEMENT_SCALE };
                shader.uniforms.uCrackIntensity = { value: ROCK_SHADER.CRACK_INTENSITY };
                shader.uniforms.uCrackScale = { value: ROCK_SHADER.CRACK_SCALE };
                shader.uniforms.uStratificationStrength = { value: ROCK_SHADER.STRATIFICATION_STRENGTH };
                shader.uniforms.uStratificationScale = { value: ROCK_SHADER.STRATIFICATION_SCALE };
                shader.uniforms.uWarmColor = { value: new THREE.Color(ROCK_SHADER.WARM_COLOR) };
                shader.uniforms.uCoolColor = { value: new THREE.Color(ROCK_SHADER.COOL_COLOR) };
                shader.uniforms.uColorVariationStrength = { value: ROCK_SHADER.COLOR_VARIATION_STRENGTH };

                if (enableMoss) {
                    shader.uniforms.uMossColor = { value: MOSS_COLOR };
                    shader.uniforms.uLichenColor = { value: LICHEN_COLOR };
                    shader.uniforms.uMossIntensity = { value: MOSS_INTENSITY };
                }

                // Build vertex shader preamble conditionally to avoid declaring
                // attributes that are not present on every geometry.
                const vertexPreamble = [
                    enableMoss ? 'attribute float mossMask;' : '',
                    enableMoss ? 'attribute float highWaterMask;' : '',
                    enableTriplanar ? `
                #if !defined( USE_LIGHTMAP ) && !defined( USE_AOMAP )
                attribute vec2 uv2;
                varying vec2 vUv2;
                #endif` : '',
                    enableMoss ? 'varying float vMossMask;' : '',
                    enableMoss ? 'varying float vHighWaterMask;' : '',
                    enableMoss ? 'varying vec3 vWorldNormal;' : '',
                    'varying float vHeightAboveWater;',
                    'varying vec3 vWorldPos;',
                    'varying vec3 vViewDir;',
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
                vViewDir = normalize(cameraPosition - vWorldPos);
                ${enableMoss ? 'vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);' : ''}
                
                ${enableMoss ? 'vMossMask = mossMask;' : ''}
                ${enableMoss ? 'vHighWaterMask = highWaterMask;' : ''}
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
                    'uniform float uWeatherWetness;',
                    'uniform sampler2D uDisplacementMap;',
                    'uniform float uDisplacementScale;',
                    'uniform float uCrackIntensity;',
                    'uniform float uCrackScale;',
                    'uniform float uStratificationStrength;',
                    'uniform float uStratificationScale;',
                    'uniform vec3 uWarmColor;',
                    'uniform vec3 uCoolColor;',
                    'uniform float uColorVariationStrength;',
                    enableMoss ? 'uniform vec3 uMossColor;' : '',
                    enableMoss ? 'uniform vec3 uLichenColor;' : '',
                    enableMoss ? 'uniform float uMossIntensity;' : '',
                    'varying float vHeightAboveWater;',
                    enableMoss ? 'varying float vMossMask;' : '',
                    enableMoss ? 'varying float vHighWaterMask;' : '',
                    enableMoss ? 'varying vec3 vWorldNormal;' : '',
                    enableTriplanar ? `
                #if !defined( USE_LIGHTMAP ) && !defined( USE_AOMAP )
                varying vec2 vUv2;
                #endif` : '',
                    'varying vec3 vWorldPos;',
                    'varying vec3 vViewDir;',
                    enableMoss ? `
                // Noise helper for organic moss variation
                float riverNoise(vec2 p) {
                    return sin(p.x * 3.0) * sin(p.y * 3.0) * 0.5 + 0.5;
                }` : '',
                    `
                // Fast hash/noise for cracks, stratification, and fallback height
                float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float noise(vec2 p) {
                    vec2 i = floor(p); vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
                }
                float fbm2(vec2 p) {
                    float value = 0.0;
                    float amp = 0.5;
                    for(int i = 0; i < 2; i++) {
                        value += noise(p) * amp;
                        p *= 2.0;
                        amp *= 0.5;
                    }
                    return value;
                }
                `,
                ].filter(Boolean).join('\n') + '\n';

                const mapFragmentReplacement = `
                // Parallax offset — vMapUv is only defined when USE_MAP is active, so
                // we initialise parallaxOffset here and compute it inside the #ifdef block.
                vec2 parallaxOffset = vec2(0.0);

                #ifdef USE_MAP
                    float dispHeight = texture2D(uDisplacementMap, vMapUv).r;
                    parallaxOffset = vViewDir.xy * dispHeight * uDisplacementScale;
                    vec4 sampledDiffuseColor = texture2D( map, vMapUv + parallaxOffset );
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
                        // Blend in secondary projection aggressively on cliffs to break tiling.
                        vec4 triplanarSample = texture2D( map, vUv2 + parallaxOffset );
                        float triplanarBlend = smoothstep( 3.0, 12.0, vHeightAboveWater );
                        float cliffBlend = pow(1.0 - abs(dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0))), 1.35);
                        float projectionBlend = clamp(max(triplanarBlend, cliffBlend * 0.85), 0.0, 1.0);
                        sampledDiffuseColor = mix( sampledDiffuseColor, triplanarSample, projectionBlend * 0.85 );
                    #endif` : ''}
                    diffuseColor *= sampledDiffuseColor;
                #endif
                `;

                let nextFragmentShader = injectShaderChunk(
                    fragmentPreamble + shader.fragmentShader,
                    '#include <map_fragment>',
                    mapFragmentReplacement,
                    'fragment shader'
                );

                nextFragmentShader = injectShaderChunk(
                    nextFragmentShader,
                    '#include <color_fragment>',
                    `
                #include <color_fragment>
                
                ${enableMoss ? `
                // Moss/Lichen bands using vertex color mask
                if (max(vMossMask, vHighWaterMask) > 0.08) {
                    // Organic variation based on world position
                    float mossNoise = riverNoise(vWorldPos.xz * 0.5 + uTime * 0.05);
                    float mossNoise2 = riverNoise(vWorldPos.xz * 1.2 - uTime * 0.03);
                    
                    // Blend between moss and lichen based on height
                    float heightFactor = smoothstep(0.0, 3.0, vHeightAboveWater);
                    vec3 growthColor = mix(uMossColor, uLichenColor, heightFactor);
                    
                    // Modulate intensity with noise
                    float floodBand = clamp(vHighWaterMask * 1.15, 0.0, 1.0);
                    float intensity = max(vMossMask, floodBand * 0.65) * uMossIntensity * (0.7 + mossNoise * 0.3);
                    intensity *= (0.8 + mossNoise2 * 0.2);
                    
                    // Height-based fade: tight band above waterline with extra flood-mark carry.
                    float mossHeightFade = 1.0 - smoothstep(2.0, 4.5, vHeightAboveWater);
                    intensity *= mossHeightFade;
                    
                    // Normal-based mask: prefer upward-facing ledges and broken shelves near water.
                    float normalFactor = smoothstep(0.15, 0.82, dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0)));
                    intensity *= normalFactor;
                    
                    // Apply moss color
                    diffuseColor.rgb = mix(diffuseColor.rgb, growthColor, intensity);
                }
                ` : ''}
                
                ${enableWetness ? `
                // Wetness effect - darker near waterline, boosted by weather
                float baseWetness = 1.0 - smoothstep(0.0, uWetnessRange, vHeightAboveWater);
                float weatherWetnessFactor = uWeatherWetness * (1.0 - smoothstep(0.0, uWetnessRange * 1.5, vHeightAboveWater));
                float combinedWetness = clamp(baseWetness + weatherWetnessFactor, 0.0, 1.0);
                
                // Darken wet areas
                float wetDarken = 1.0 - (combinedWetness * ${(1.0 - ROCK_SHADER.WETNESS_DARKEN).toFixed(2)});
                diffuseColor.rgb *= wetDarken;
                ` : ''}
                
                // Procedural cracks
                float crackNoise = fbm2(vWorldPos.xz * uCrackScale + parallaxOffset * 2.0);
                float crackMask = smoothstep(0.55, 0.65, crackNoise);
                diffuseColor.rgb *= (1.0 - crackMask * uCrackIntensity);
                
                // Stratification (secondary)
                float stratWarp = fbm2(vWorldPos.xz * (uStratificationScale * 0.35) + vec2(4.1, -2.7));
                float strat = sin(vWorldPos.y * uStratificationScale + stratWarp * 4.5 + hash(vWorldPos.xz) * 2.0) * 0.5 + 0.5;
                float stratContrast = smoothstep(0.18, 0.82, strat);
                diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (0.78 + stratContrast * 0.32), uStratificationStrength * 0.7);
                
                // Color variation (secondary)
                float heightRatio = clamp(vHeightAboveWater / 12.0, 0.0, 1.0);
                vec3 heightTint = mix(uWarmColor, uCoolColor, heightRatio);
                diffuseColor.rgb = mix(diffuseColor.rgb, heightTint, uColorVariationStrength * (0.35 + heightRatio * 0.65));
                diffuseColor.rgb *= 1.0 - clamp(vHighWaterMask, 0.0, 1.0) * 0.08;
                `,
                    'fragment shader'
                );

                // Roughness reduction in wet areas
                if (nextFragmentShader.includes('#include <roughnessmap_fragment>')) {
                    nextFragmentShader = injectShaderChunk(
                        nextFragmentShader,
                        '#include <roughnessmap_fragment>',
                        `
                    #include <roughnessmap_fragment>
                    float baseWetnessR = 1.0 - smoothstep(0.0, uWetnessRange, vHeightAboveWater);
                    float weatherWetnessR = uWeatherWetness * (1.0 - smoothstep(0.0, uWetnessRange * 1.5, vHeightAboveWater));
                    float combinedWetnessR = clamp(baseWetnessR + weatherWetnessR, 0.0, 1.0);
                    roughnessFactor *= 1.0 - (combinedWetnessR * 0.35);
                    `,
                        'fragment shader roughness'
                    );
                }

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
 * @param {Object|number} options - Options object or legacy waterLevel number
 */
export function updateRiverMaterial(material, time, options = {}) {
    if (!material || !material.userData.shader) return;

    const shader = material.userData.shader;
    if (shader.uniforms) {
        shader.uniforms.uTime.value = time;
        if (typeof options === 'number') {
            // backward compatibility: third arg used to be waterLevel
            if (shader.uniforms.uWaterLevel) {
                shader.uniforms.uWaterLevel.value = options;
            }
        } else if (options && typeof options === 'object') {
            if (options.waterLevel !== undefined && shader.uniforms.uWaterLevel) {
                shader.uniforms.uWaterLevel.value = options.waterLevel;
            }
            if (options.weatherWetness !== undefined && shader.uniforms.uWeatherWetness) {
                shader.uniforms.uWeatherWetness.value = options.weatherWetness;
            }
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
