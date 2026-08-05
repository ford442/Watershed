import * as THREE from 'three';

export interface TreeShaderOptions {
  windStrength?: number;
  windSpeed?: number;
  sssColor?: string;
  sssStrength?: number;
  waterLevel?: number;
  rustleRadius?: number;
  rustleStrength?: number;
}

type TreeMaterial = THREE.Material & {
  userData: {
    treeUniforms?: { uPlayerPos: { value: THREE.Vector3 } };
    treeShader?: THREE.WebGLProgramParametersWithUniforms | null;
    treeShaderFailed?: boolean;
  };
  onBeforeCompile?: (shader: THREE.WebGLProgramParametersWithUniforms, renderer?: THREE.WebGLRenderer) => void;
  side: THREE.Side;
  needsUpdate: boolean;
};

function injectShaderChunk(source: string, marker: string, replacement: string, label: string): string {
    if (!source.includes(marker)) {
        throw new Error(`TreeShader: Missing shader marker "${marker}" in ${label}`);
    }
    return source.replace(marker, replacement);
}

export function extendTreeMaterial(material: TreeMaterial | null | undefined, options: TreeShaderOptions = {}): void {
    if (!material) return;

    const {
        windStrength = 0.12,
        windSpeed = 1.6,
        sssColor = '#ffe8b0',
        sssStrength = 0.35,
        waterLevel = 0.5,
        rustleRadius = 6.0,
        rustleStrength = 2.5,
    } = options;

    try {
        material.userData.treeUniforms = {
            uPlayerPos: { value: new THREE.Vector3(1e6, 1e6, 1e6) },
        };

        material.onBeforeCompile = (shader) => {
            try {
                shader.uniforms.uTime = { value: 0 };
                shader.uniforms.uWindStrength = { value: windStrength };
                shader.uniforms.uWindSpeed = { value: windSpeed };
                shader.uniforms.uSSSColor = { value: new THREE.Color(sssColor) };
                shader.uniforms.uSSSStrength = { value: sssStrength };
                shader.uniforms.uWaterLevel = { value: waterLevel };
                shader.uniforms.uRustleRadius = { value: rustleRadius };
                shader.uniforms.uRustleStrength = { value: rustleStrength };
                shader.uniforms.uPlayerPos = material.userData.treeUniforms!.uPlayerPos;

                const vertexPreamble = [
                    'attribute float windFactor;',
                    'attribute float isFoliage;',
                    'attribute float isFoliageCard;',
                    'attribute float leafSeed;',
                    'attribute vec2 cardUv;',
                    'varying float vIsFoliage;',
                    'varying float vIsFoliageCard;',
                    'varying vec2 vCardUv;',
                    'varying vec3 vTreeWorldPos;',
                    'uniform float uTime;',
                    'uniform float uWindStrength;',
                    'uniform float uWindSpeed;',
                    'uniform float uRustleRadius;',
                    'uniform float uRustleStrength;',
                    'uniform vec3 uPlayerPos;',
                ].join('\n') + '\n';

                shader.vertexShader = injectShaderChunk(
                    vertexPreamble + shader.vertexShader,
                    '#include <begin_vertex>',
                    `
                #include <begin_vertex>

                #ifdef USE_INSTANCING
                    vec3 treeInstOrigin = instanceMatrix[3].xyz;
                #else
                    vec3 treeInstOrigin = vec3(0.0);
                #endif
                vec3 treeInstWorldPos = (modelMatrix * vec4(treeInstOrigin, 1.0)).xyz;

                // Player rustle: nearby trees sway/flutter harder
                float distToPlayer = length(treeInstWorldPos.xz - uPlayerPos.xz);
                float rustle = (1.0 - smoothstep(0.0, uRustleRadius, distToPlayer)) * uRustleStrength;

                float treeInstSeed = treeInstOrigin.x * 0.7 + treeInstOrigin.z * 1.3;
                float windPhase = uTime * uWindSpeed + treeInstSeed;
                float windAmount = uWindStrength * (1.0 + rustle);
                float windSway = sin(windPhase) * windFactor * windAmount;
                float windSwaySecondary = sin(windPhase * 2.3 + 1.7) * windFactor * windAmount * 0.35;
                transformed.x += windSway;
                transformed.z += windSway * 0.6 + windSwaySecondary;

                // Leaf/needle flutter: faster, per-card secondary motion
                float flutterPhase = uTime * (5.0 + rustle * 3.0) + leafSeed * 6.2831;
                float flutter = sin(flutterPhase) * 0.05 * isFoliageCard * (1.0 + rustle);
                transformed.x += flutter * cos(leafSeed * 6.2831);
                transformed.z += flutter * sin(leafSeed * 6.2831);
                transformed.y += abs(flutter) * 0.3;

                vIsFoliage = isFoliage;
                vIsFoliageCard = isFoliageCard;
                vCardUv = cardUv;

                vec4 treeVertex = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                    treeVertex = instanceMatrix * treeVertex;
                #endif
                vTreeWorldPos = (modelMatrix * treeVertex).xyz;
                `,
                    'vertex shader'
                );

                const fragmentPreamble = [
                    'varying float vIsFoliage;',
                    'varying float vIsFoliageCard;',
                    'varying vec2 vCardUv;',
                    'varying vec3 vTreeWorldPos;',
                    'uniform vec3 uSSSColor;',
                    'uniform float uSSSStrength;',
                    'uniform float uWaterLevel;',
                ].join('\n') + '\n';

                shader.fragmentShader = injectShaderChunk(
                    fragmentPreamble + shader.fragmentShader,
                    '#include <clipping_planes_fragment>',
                    `
                #include <clipping_planes_fragment>

                // Carve a serrated leaf/needle silhouette out of card quads
                if (vIsFoliageCard > 0.5) {
                    vec2 lc = vCardUv - 0.5;
                    float angle = atan(lc.y, lc.x);
                    float serration = sin(angle * 14.0) * 0.05 + cos(angle * 5.0) * 0.03;
                    float leafShape = (lc.x * lc.x) / (0.22 * 0.22) + (lc.y * lc.y) / (0.5 * 0.5);
                    if (leafShape > 1.0 - serration) discard;
                }
                `,
                    'fragment shader clipping'
                );

                shader.fragmentShader = injectShaderChunk(
                    shader.fragmentShader,
                    '#include <emissivemap_fragment>',
                    `
                #include <emissivemap_fragment>

                // Cheap fresnel-based backlight/translucency for foliage
                float treeFresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewPosition)), 0.0), 2.0);
                totalEmissiveRadiance += uSSSColor * treeFresnel * vIsFoliage * uSSSStrength;
                `,
                    'fragment shader emissive'
                );

                if (shader.fragmentShader.includes('#include <roughnessmap_fragment>')) {
                    shader.fragmentShader = injectShaderChunk(
                        shader.fragmentShader,
                        '#include <roughnessmap_fragment>',
                        `
                    #include <roughnessmap_fragment>
                    // Wet sheen: foliage near the waterline reads as damp/glossy
                    float treeWetness = (1.0 - smoothstep(0.0, 3.0, abs(vTreeWorldPos.y - uWaterLevel))) * vIsFoliage;
                    roughnessFactor *= 1.0 - treeWetness * 0.45;
                    `,
                        'fragment shader roughness'
                    );
                }

                material.userData.treeShader = shader;
                material.userData.treeShaderFailed = false;
            } catch (error) {
                material.userData.treeShader = null;
                material.userData.treeShaderFailed = true;
                console.error('TreeShader: Error compiling shader injection:', error);
            }
        };

        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
    } catch (e) {
        console.warn('TreeShader: Error setting up shader injection:', e);
    }
}

/**
 * Update per-frame uniforms (call in useFrame)
 * @param {THREE.Material} material
 * @param {number} time
 * @param {THREE.Vector3} [playerPos] - world-space position used for the rustle effect
 */
export function updateTreeMaterial(
  material: TreeMaterial | null | undefined,
  time: number,
  playerPos?: THREE.Vector3,
): void {
    if (!material) return;
    if (material.userData.treeUniforms && playerPos) {
        material.userData.treeUniforms.uPlayerPos.value.copy(playerPos);
    }
    if (!material.userData.treeShader) return;
    material.userData.treeShader.uniforms.uTime.value = time;
}
