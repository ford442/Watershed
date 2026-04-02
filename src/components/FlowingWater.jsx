// src/components/FlowingWater.jsx
// FINAL + POLISHED: Dynamic shader loading + fallback + hot-swap + flow-field prep

import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { SHADERS, WATER_LEVEL } from '../constants/game';
import { useShaderLoader } from '../hooks/useShaderLoader';

export default function FlowingWater({
    geometry,
    flowSpeed = 1.2,
    baseColor = SHADERS.WATER_COLOR,
    foamColor = SHADERS.WATER_FOAM_COLOR,
    edgeHighlightColor = SHADERS.WATER_EDGE_COLOR,
    shaderId = null,
    onShaderLoad = null,
}) {
    const materialRef = useRef(null);
    const { camera } = useThree();

    // Built-in fallback shader
    const builtinFragmentShader = useMemo(() => `
        uniform float time;
        uniform float flowSpeed;
        uniform vec3 cameraPos;
        uniform vec3 waterColor;
        uniform vec3 deepColor;
        uniform vec3 foamColor;
        uniform vec3 edgeHighlight;
        varying vec2 vUv;
        varying float vWave;
        varying float vCurrent;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying float vCameraProximity;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                       mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p) {
            float value = 0.0;
            float amp = 0.55;
            value += noise(p) * amp;
            p = p * 2.1 + vec2(4.2, 7.1);
            amp *= 0.5;
            value += noise(p) * amp;
            p = p * 1.9 + vec2(2.4, 3.7);
            amp *= 0.5;
            value += noise(p) * amp;
            return value;
        }

        void main() {
            vec2 flowUv  = vUv + vec2(0.0, -time * flowSpeed * 0.12);
            vec2 flowUv2 = vUv + vec2(time * flowSpeed * 0.04, -time * flowSpeed * 0.09);
            vec2 currentUv = vec2(vUv.x * 2.6 + time * flowSpeed * 0.02, vUv.y * 11.5 - time * flowSpeed * 0.28);

            float n1 = noise(flowUv  * 6.0);
            float n2 = noise(flowUv  * 12.0 + vec2(1.3, 0.7));
            float n3 = noise(flowUv2 * 5.0  + vec2(0.5, 1.1));
            float n4 = fbm(flowUv2 * 8.0 + vec2(time * flowSpeed * 0.03, -time * flowSpeed * 0.14));
            float currentStreak = smoothstep(0.48, 0.72, fbm(currentUv));

            float foamCoarse = smoothstep(0.52, 0.72, n1 * 0.45 + n3 * 0.35 + n4 * 0.2 + vCurrent * 0.28);
            float foamFine   = smoothstep(0.62, 0.8, n2 * 0.55  + n1 * 0.35 + currentStreak * 0.2 + vWave * 0.1);
            
            float edgeDist = abs(vUv.x - 0.5);
            float shoreFoamMask = smoothstep(0.22, 0.03, edgeDist);
            float midFoamMask = smoothstep(0.35, 0.15, edgeDist) * (1.0 - shoreFoamMask);
            
            float shoreFoam = shoreFoamMask * (0.55 + n4 * 0.55 + vCurrent * 0.35) * (0.8 + vWave * 0.4);
            float midFoam = midFoamMask * (0.25 + n3 * 0.35) * (0.5 + vCurrent * 0.3);
            
            float bankFoam = shoreFoam + midFoam * 0.6;
            float foam = foamCoarse * 0.42 + foamFine * 0.28 + bankFoam;
            foam = clamp(foam, 0.0, 1.0);

            float depthFactor = 1.0 - abs(vUv.x - 0.5) * 1.6;
            depthFactor = clamp(depthFactor, 0.0, 1.0);
            vec3 baseWater = mix(waterColor, deepColor, depthFactor * (0.45 + vCurrent * 0.18));
            baseWater = mix(baseWater, edgeHighlight, currentStreak * 0.11 * vCurrent);

            float fresnel = pow(1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0), 2.5);
            vec3 col = mix(baseWater, foamColor, foam);
            col = mix(col, edgeHighlight, fresnel * 0.22);

            float glint = smoothstep(0.78, 0.98, vWave) * (0.2 + vCurrent * 0.25);
            glint += currentStreak * (0.05 + vCurrent * 0.12);
            col += vec3(glint);

            float alpha = 0.7 + vWave * 0.1 + foam * 0.08 + vCurrent * 0.06;
            gl_FragColor = vec4(col, clamp(alpha, 0.62, 0.94));
        }
    `, []);

    // Load dynamic shader from FastAPI backend
    const { code: dynamicShaderCode, loading: shaderLoading, error: shaderError } =
        useShaderLoader(shaderId, builtinFragmentShader);

    React.useEffect(() => {
        if (onShaderLoad && !shaderLoading) {
            onShaderLoad(dynamicShaderCode, shaderError);
        }
    }, [dynamicShaderCode, shaderError, shaderLoading, onShaderLoad]);

    const fragmentShader = dynamicShaderCode || builtinFragmentShader;

    const material = useMemo(() => {
        try {
            const mat = new THREE.ShaderMaterial({
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                uniforms: {
                    time: { value: 0 },
                    flowSpeed: { value: flowSpeed },
                    cameraPos: { value: new THREE.Vector3() },
                    waterColor: { value: new THREE.Color(baseColor) },
                    deepColor: { value: new THREE.Color(baseColor).multiplyScalar(0.55) },
                    foamColor: { value: new THREE.Color(foamColor) },
                    edgeHighlight: { value: new THREE.Color(edgeHighlightColor) },
                },
                vertexShader: `
                    uniform float time;
                    uniform float flowSpeed;
                    uniform vec3 cameraPos;
                    varying vec2 vUv;
                    varying float vWave;
                    varying float vCurrent;
                    varying vec3 vNormal;
                    varying vec3 vViewDir;
                    varying float vCameraProximity;

                    void main() {
                        vUv = uv;
                        vec3 pos = position;
                        
                        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
                        
                        float distToCamera = distance(worldPos.xyz, cameraPos);
                        vCameraProximity = 1.0 - smoothstep(5.0, 25.0, distToCamera);
                        float proxAmp = 1.0 + vCameraProximity * 0.35;
                        
                        float wave1 = sin(pos.x * 0.5  + time * flowSpeed * 1.2) * 0.09 * proxAmp;
                        float wave2 = sin(pos.z * 0.4  + time * flowSpeed * 0.9 + 1.57) * 0.07 * proxAmp;
                        float wave3 = sin((pos.x + pos.z) * 0.3 + time * flowSpeed * 0.7) * 0.05 * proxAmp;
                        float wave4 = sin(pos.x * 1.3  + pos.z * 0.8 + time * flowSpeed * 1.5) * 0.025 * proxAmp;
                        pos.y += wave1 + wave2 + wave3 + wave4;
                        vWave = (wave1 + wave2 + wave3 + wave4 + 0.215) / 0.43;
                        vCurrent = clamp((abs(wave1) + abs(wave2) + abs(wave3) + abs(wave4)) * 2.3, 0.0, 1.0);

                        vViewDir = normalize(cameraPosition - worldPos.xyz);
                        vNormal = normalMatrix * normal;

                        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                    }
                `,
                fragmentShader,
            });

            // Expose flow field sampler for physics (used by useWaterFlowField)
            mat.userData.waterFlowField = {
                waterLevel: WATER_LEVEL,
                flowSpeed,
                sampleAt: (position, time) => {
                    const x = position.x * 0.35;
                    const z = position.z * 0.28 - time * flowSpeed * 0.15;
                    return {
                        direction: new THREE.Vector3(Math.sin(z) * 0.25, 0, -1).normalize(),
                        speed: flowSpeed * (1 + Math.sin(x + z) * 0.12),
                    };
                },
            };

            materialRef.current = mat;
            console.log(
                dynamicShaderCode && dynamicShaderCode !== builtinFragmentShader
                    ? '[FlowingWater] 🔥 Using dynamic shader from backend'
                    : '[FlowingWater] ✅ Using built-in shader'
            );

            return mat;
        } catch (e) {
            console.warn('[FlowingWater] Shader compile failed, using basic fallback');
            return new THREE.MeshBasicMaterial({
                color: new THREE.Color(baseColor),
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide,
            });
        }
    }, [baseColor, edgeHighlightColor, flowSpeed, foamColor, fragmentShader, dynamicShaderCode, builtinFragmentShader]);

    // Update uniforms safely (avoid stale closure)
    useFrame((state) => {
        const mat = materialRef.current;
        if (mat?.uniforms?.time && mat?.uniforms?.cameraPos) {
            mat.uniforms.time.value = state.clock.elapsedTime;
            mat.uniforms.cameraPos.value.copy(camera.position);
        }
    });

    return (
        <>
            <mesh geometry={geometry} material={material} />

            {/* Loading overlay while fetching from backend */}
            {shaderLoading && shaderId && (
                <mesh geometry={geometry}>
                    <meshBasicMaterial
                        color="#1a6b8a"
                        transparent
                        opacity={0.35}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            )}
        </>
    );
}
