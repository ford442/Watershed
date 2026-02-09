import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * FlowingWater - Animated water surface with flow effect
 * Creates rushing white water effect for creek rapids
 * 
 * @param {THREE.BufferGeometry} geometry - Water surface geometry
 * @param {number} flowSpeed - Speed of water flow animation (default: 1.2)
 * @param {string} baseColor - Base water color (default: #1a7b9c)
 * @param {string} foamColor - Foam/white water color (default: #ffffff)
 * @param {THREE.Texture} normalMap - Optional normal map for surface detail
 */
export default function FlowingWater({ 
    geometry, 
    flowSpeed = 1.2,
    baseColor = '#1a7b9c',
    foamColor = '#e0f7fa', // Slightly off-white for natural look
    normalMap = null
}) {
    // Custom shader material for flowing water effect
    const material = useMemo(() => {
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(baseColor),
            roughness: 0.1, // Wet
            metalness: 0.1, // Stylized water
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            normalMap: normalMap,
            normalScale: new THREE.Vector2(0.5, 0.5), // Subtle ripple
        });

        mat.onBeforeCompile = (shader) => {
            try {
                shader.uniforms.time = { value: 0 };
                shader.uniforms.flowSpeed = { value: flowSpeed };
                shader.uniforms.foamColor = { value: new THREE.Color(foamColor) };
                shader.uniforms.waterColor = { value: new THREE.Color(baseColor) };

            // Inject Uniforms
            shader.vertexShader = `
                uniform float time;
                uniform float flowSpeed;
                varying float vElevation;
                varying vec2 vFlowUv;
            ` + shader.vertexShader;

            shader.fragmentShader = `
                uniform float time;
                uniform float flowSpeed;
                uniform vec3 foamColor;
                uniform vec3 waterColor;
                varying float vElevation;
                varying vec2 vFlowUv;
            ` + shader.fragmentShader;

            // --- Vertex Shader: Wave Displacement ---
            const originalVertexShader = shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `
                #include <common>

                // Simplex noise function for organic wave motion
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
                
                float snoise(vec2 v) {
                    const vec4 C = vec4(0.211324865405187,
                                        0.366025403784439,
                                       -0.577350269189626,
                                        0.024390243902439);
                    vec2 i  = floor(v + dot(v, C.yy) );
                    vec2 x0 = v -   i + dot(i, C.xx);
                    vec2 i1;
                    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                    vec4 x12 = x0.xyxy + C.xxzz;
                    x12.xy -= i1;
                    i = mod289(i);
                    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
                        + i.x + vec3(0.0, i1.x, 1.0 ));
                    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                    m = m*m ;
                    m = m*m ;
                    vec3 x = 2.0 * fract(p * C.www) - 1.0;
                    vec3 h = abs(x) - 0.5;
                    vec3 ox = floor(x + 0.5);
                    vec3 a0 = x - ox;
                    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
                    vec3 g;
                    g.x  = a0.x  * x0.x  + h.x  * x0.y;
                    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                    return 130.0 * dot(m, g);
                }

                float getWaveHeight(vec3 pos, float time, float speed) {
                    float flowTime = time * speed;
                    float wave1 = snoise(vec2(pos.x * 0.3, pos.z * 0.3 - flowTime * 0.5)) * 0.15;
                    float wave2 = snoise(vec2(pos.x * 0.8, pos.z * 0.8 - flowTime * 0.8)) * 0.08;
                    float wave3 = snoise(vec2(pos.x * 2.0, pos.z * 2.0 - flowTime * 1.5)) * 0.04;
                    float turbulence = snoise(vec2(pos.x * 1.5 + flowTime * 0.3, pos.z * 1.2 - flowTime * 0.7)) * 0.05;
                    return wave1 + wave2 + wave3 + turbulence;
                }
                `
            );
            
            if (shader.vertexShader === originalVertexShader) {
                console.warn('[FlowingWater] Failed to inject #include <common> in vertex shader');
            }

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                
                // Calculate Elevation
                float elevation = getWaveHeight(position, time, flowSpeed);
                transformed.y += elevation;
                vElevation = elevation;

                // Pass flow UV for fragment shader
                vFlowUv = uv;
                vFlowUv.y -= time * flowSpeed * 0.3;
                `
            );
            
            if (!shader.vertexShader.includes('getWaveHeight')) {
                console.warn('[FlowingWater] Failed to inject wave height logic in vertex shader');
            }

            // --- Fragment Shader ---
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `
                #include <common>
                
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
                
                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    float a = hash(i);
                    float b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0));
                    float d = hash(i + vec2(1.0, 1.0));
                    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
                }
                `
            );

            // Validate common injection
            if (!shader.fragmentShader.includes('float hash(vec2 p)')) {
                console.warn('[FlowingWater] Failed to inject noise functions in fragment shader');
            }

            // 1. Calculate Foam at the start of main
            const originalFragmentShader = shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <begin_fragment>',
                `
                #include <begin_fragment>

                // --- FLOWING WATER LOGIC ---

                // Calculate Foam Factor
                float foamFactor = smoothstep(0.05, 0.15, vElevation);

                // Edge Foam logic (Shoreline interaction)
                float edgeDist = min(vFlowUv.x, 1.0 - vFlowUv.x);
                float edgeFoam = smoothstep(0.12, 0.02, edgeDist); // Foam within 12% of edge

                // Animated foam noise
                float foamNoise = noise(vFlowUv * 12.0 + time * flowSpeed);
                foamNoise += noise(vFlowUv * 25.0 - time * flowSpeed * 0.5) * 0.5;

                // Combine wave foam and edge foam
                float foam = max(foamFactor * foamNoise, edgeFoam * (foamNoise * 0.8 + 0.4));
                foam += step(0.65, foamNoise) * 0.2; // Sparkles
                foam = clamp(foam, 0.0, 1.0);
                `
            );
            
            if (shader.fragmentShader === originalFragmentShader) {
                console.warn('[FlowingWater] Failed to inject #include <begin_fragment>');
            }

            // 2. Animated Normal Map (Flowing Ripples)
            const beforeNormalMap = shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <normal_fragment_maps>',
                `
                #ifdef USE_NORMALMAP
                    // Use vFlowUv to create animated texture coordinates
                    // Apply the texture matrix (repeat/offset) to the flow UVs
                    vec2 rippleUv = (normalMapTransform * vec3(vFlowUv, 1.0)).xy;

                    vec3 mapN = texture2D( normalMap, rippleUv ).xyz * 2.0 - 1.0;
                    mapN.xy *= normalScale;

                    #ifdef USE_TANGENT
                        normal = normalize( vTBN * mapN );
                    #else
                        normal = perturbNormal2Arb( - vViewPosition, normal, mapN, faceDirection );
                    #endif
                #endif
                `
            );
            
            if (shader.fragmentShader === beforeNormalMap) {
                console.warn('[FlowingWater] Failed to inject #include <normal_fragment_maps>');
            }

            // 3. Roughness Modulation (Foam is rougher)
            const beforeRoughness = shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <roughnessmap_fragment>',
                `
                #include <roughnessmap_fragment>

                // Water is smooth (0.1), Foam is rough (0.8)
                roughnessFactor = mix(roughnessFactor, 0.8, foam);
                `
            );
            
            if (shader.fragmentShader === beforeRoughness) {
                console.warn('[FlowingWater] Failed to inject #include <roughnessmap_fragment>');
            }

            // 4. Mix Foam into Diffuse Color (Before Lighting)
            // AND Implement Depth Color Gradient
            const beforeMapFragment = shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `
                #include <map_fragment>

                // --- DEPTH GRADIENT ---
                // Center of river (uv.x = 0.5) is deep, edges (uv.x = 0 or 1) are shallow
                float centerDist = 1.0 - abs(vFlowUv.x - 0.5) * 2.0; // 0 at edge, 1 at center
                centerDist = pow(centerDist, 0.4); // Bias towards deep color

                vec3 deepColor = waterColor * 0.6; // Darker, richer
                vec3 shallowColor = waterColor * 1.1; // Lighter

                vec3 waterGradient = mix(shallowColor, deepColor, centerDist);

                // Mix foam color into diffuse (base) color
                diffuseColor.rgb = mix(waterGradient, foamColor, foam);
                `
            );
            
            if (shader.fragmentShader === beforeMapFragment) {
                console.warn('[FlowingWater] Failed to inject #include <map_fragment>');
            }

                mat.userData.shader = shader;
            } catch (error) {
                console.error('[FlowingWater] Shader compilation error:', error);
                console.error('Shader vertex (first 500 chars):', shader.vertexShader?.substring(0, 500));
                console.error('Shader fragment (first 500 chars):', shader.fragmentShader?.substring(0, 500));
            }
        };

        return mat;
    }, [flowSpeed, baseColor, foamColor, normalMap]);
    
    // Animate the water
    useFrame((state) => {
        if (material.userData.shader) {
            material.userData.shader.uniforms.time.value = state.clock.elapsedTime;
        }
    });
    
    return (
        <mesh geometry={geometry} material={material} receiveShadow />
    );
}
