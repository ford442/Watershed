import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/**
 * FlowingWater - Animated water surface with enhanced wave, foam, and depth shader
 */
export default function FlowingWater({ 
    geometry, 
    flowSpeed = 1.2,
    baseColor = '#1a7b9c',
}) {
    const materialRef = useRef(null);

    const material = useMemo(() => {
        try {
            const mat = new THREE.ShaderMaterial({
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                uniforms: {
                    time: { value: 0 },
                    flowSpeed: { value: flowSpeed },
                    waterColor: { value: new THREE.Color(baseColor) },
                    deepColor: { value: new THREE.Color(baseColor).multiplyScalar(0.55) },
                    foamColor: { value: new THREE.Color('#dff4ff') },
                    edgeHighlight: { value: new THREE.Color('#8be8ff') },
                },
                vertexShader: `
                    uniform float time;
                    uniform float flowSpeed;
                    varying vec2 vUv;
                    varying float vWave;
                    varying vec3 vNormal;
                    varying vec3 vViewDir;

                    void main() {
                        vUv = uv;
                        vec3 pos = position;
                        float wave1 = sin(pos.x * 0.5  + time * flowSpeed * 1.2) * 0.09;
                        float wave2 = sin(pos.z * 0.4  + time * flowSpeed * 0.9 + 1.57) * 0.07;
                        float wave3 = sin((pos.x + pos.z) * 0.3 + time * flowSpeed * 0.7) * 0.05;
                        float wave4 = sin(pos.x * 1.3  + pos.z * 0.8 + time * flowSpeed * 1.5) * 0.025;
                        pos.y += wave1 + wave2 + wave3 + wave4;
                        vWave = (wave1 + wave2 + wave3 + wave4 + 0.215) / 0.43;

                        // Approximate view direction for fresnel
                        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
                        vViewDir = normalize(cameraPosition - worldPos.xyz);
                        vNormal = normalMatrix * normal;

                        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float time;
                    uniform float flowSpeed;
                    uniform vec3 waterColor;
                    uniform vec3 deepColor;
                    uniform vec3 foamColor;
                    uniform vec3 edgeHighlight;
                    varying vec2 vUv;
                    varying float vWave;
                    varying vec3 vNormal;
                    varying vec3 vViewDir;

                    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                    float noise(vec2 p) {
                        vec2 i = floor(p); vec2 f = fract(p);
                        f = f * f * (3.0 - 2.0 * f);
                        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
                    }

                    void main() {
                        // Primary scrolling flow UVs
                        vec2 flowUv  = vUv + vec2(0.0, -time * flowSpeed * 0.12);
                        // Secondary offset layer for richness
                        vec2 flowUv2 = vUv + vec2(time * flowSpeed * 0.04, -time * flowSpeed * 0.09);

                        float n1 = noise(flowUv  * 6.0);
                        float n2 = noise(flowUv  * 12.0 + vec2(1.3, 0.7));
                        float n3 = noise(flowUv2 * 5.0  + vec2(0.5, 1.1));

                        // Two-layer foam: coarse patches + fine detail
                        float foamCoarse = smoothstep(0.52, 0.72, n1 * 0.55 + n3 * 0.45 + vWave * 0.25);
                        float foamFine   = smoothstep(0.62, 0.78, n2 * 0.6  + n1 * 0.4  + vWave * 0.2);
                        float foam = foamCoarse * 0.55 + foamFine * 0.35;

                        // Depth gradient: center (v~0.5) is deeper
                        float depthFactor = 1.0 - abs(vUv.x - 0.5) * 1.6;
                        depthFactor = clamp(depthFactor, 0.0, 1.0);
                        vec3 baseWater = mix(waterColor, deepColor, depthFactor * 0.5);

                        // Fresnel-like edge highlight via view/normal dot product
                        // vNormal is already transformed by normalMatrix in vertex shader;
                        // vViewDir is already normalized in vertex shader.
                        float fresnel = pow(1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0), 2.5);
                        vec3 col = mix(baseWater, foamColor, foam);
                        col = mix(col, edgeHighlight, fresnel * 0.22);

                        // Subtle specular glint using wave crest
                        float glint = smoothstep(0.78, 0.98, vWave) * 0.35;
                        col += vec3(glint);

                        float alpha = 0.72 + vWave * 0.14 + foam * 0.1;
                        gl_FragColor = vec4(col, clamp(alpha, 0.6, 0.95));
                    }
                `,
            });
            materialRef.current = mat;
            return mat;
        } catch (e) {
            console.warn('[FlowingWater] Shader error, falling back to basic material:', e);
            return new THREE.MeshBasicMaterial({
                color: new THREE.Color(baseColor),
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide,
            });
        }
    }, [baseColor, flowSpeed]);

    useFrame((state) => {
        if (material.uniforms) {
            material.uniforms.time.value = state.clock.elapsedTime;
        }
    });

    return (
        <mesh geometry={geometry} material={material} />
    );
}
