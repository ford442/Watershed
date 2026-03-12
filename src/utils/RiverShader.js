import * as THREE from 'three';

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
const WATER_LEVEL_Y = 13.0;
const WETNESS_RANGE = 4.0;

// Moss/Lichen colors
const MOSS_COLOR = new THREE.Color('#4a6b44');      // Deep moss green
const LICHEN_COLOR = new THREE.Color('#7a9a78');    // Lighter lichen
const MOSS_INTENSITY = 0.6;

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
            // Add custom uniforms
            shader.uniforms.uWaterLevel = { value: waterLevel };
            shader.uniforms.uWetnessRange = { value: wetnessRange };
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uMossColor = { value: MOSS_COLOR };
            shader.uniforms.uLichenColor = { value: LICHEN_COLOR };
            shader.uniforms.uMossIntensity = { value: MOSS_INTENSITY };
            
            // Add vertex shader headers
            shader.vertexShader = `
                // RiverShader vertex attributes
                attribute float mossMask;
                attribute vec2 uv2;
                
                varying float vHeightAboveWater;
                varying float vMossMask;
                varying vec2 vUv2;
                varying vec3 vWorldPos;
                
                uniform float uWaterLevel;
            ` + shader.vertexShader;
            
            // Inject vertex calculations
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                
                // Calculate height above water for wetness gradient
                vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                vHeightAboveWater = vWorldPos.y - uWaterLevel;
                
                // Pass moss mask and secondary UVs
                vMossMask = mossMask;
                vUv2 = uv2;
                `
            );
            
            // Add fragment shader headers
            shader.fragmentShader = `
                // RiverShader uniforms and varyings
                uniform float uWaterLevel;
                uniform float uWetnessRange;
                uniform float uTime;
                uniform vec3 uMossColor;
                uniform vec3 uLichenColor;
                uniform float uMossIntensity;
                
                varying float vHeightAboveWater;
                varying float vMossMask;
                varying vec2 vUv2;
                varying vec3 vWorldPos;
                
                // Noise function for organic variation
                float riverNoise(vec2 p) {
                    return sin(p.x * 3.0) * sin(p.y * 3.0) * 0.5 + 0.5;
                }
            ` + shader.fragmentShader;
            
            // Inject color modifications after map_fragment
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `
                #include <map_fragment>
                
                // Sample texture with triplanar UV blend if available
                #ifdef USE_MAP
                    vec4 texelColor1 = texture2D(map, vMapUv);
                    vec4 texelColor2 = texture2D(map, vUv2);
                    
                    // Blend between standard UV and triplanar based on height
                    float triplanarBlend = smoothstep(0.0, 8.0, vHeightAboveWater);
                    vec4 blendedTexel = mix(texelColor2, texelColor1, triplanarBlend * 0.6 + 0.2);
                    
                    // Apply vertex color tint
                    blendedTexel.rgb *= vColor.rgb;
                    
                    diffuseColor *= blendedTexel;
                #else
                    // No texture - use vertex colors directly
                    diffuseColor.rgb *= vColor.rgb;
                #endif
                `
            );
            
            // Inject moss/lichen coloring before color_fragment
            shader.fragmentShader = shader.fragmentShader.replace(
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
                `
            );
            
            // Store shader reference for animation updates
            material.userData.shader = shader;
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
