import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/**
 * FlowingWater - Animated water surface with wave and foam shader
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
                    foamColor: { value: new THREE.Color('#d0f0ff') },
                },
                vertexShader: `
                    uniform float time;
                    uniform float flowSpeed;
                    varying vec2 vUv;
                    varying float vWave;

                    void main() {
                        vUv = uv;
                        vec3 pos = position;
                        float wave1 = sin(pos.x * 0.5 + time * flowSpeed * 1.2) * 0.08;
                        float wave2 = sin(pos.z * 0.4 + time * flowSpeed * 0.9 + 1.57) * 0.06;
                        float wave3 = sin((pos.x + pos.z) * 0.3 + time * flowSpeed * 0.7) * 0.04;
                        pos.y += wave1 + wave2 + wave3;
                        vWave = (wave1 + wave2 + wave3 + 0.18) / 0.36;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float time;
                    uniform float flowSpeed;
                    uniform vec3 waterColor;
                    uniform vec3 foamColor;
                    varying vec2 vUv;
                    varying float vWave;

                    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                    float noise(vec2 p) {
                        vec2 i = floor(p); vec2 f = fract(p);
                        f = f * f * (3.0 - 2.0 * f);
                        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
                    }

                    void main() {
                        vec2 flowUv = vUv + vec2(0.0, -time * flowSpeed * 0.12);
                        float n1 = noise(flowUv * 6.0);
                        float n2 = noise(flowUv * 12.0 + vec2(1.3, 0.7));
                        float foam = smoothstep(0.55, 0.75, n1 * 0.6 + n2 * 0.4 + vWave * 0.3);
                        vec3 col = mix(waterColor, foamColor, foam * 0.5);
                        float depth = 0.75 + vWave * 0.15;
                        gl_FragColor = vec4(col, depth);
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
