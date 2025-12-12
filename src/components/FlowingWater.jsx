import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * FlowingWater - Animated water surface with flow effect
 * Creates rushing white water effect for creek rapids
 * 
 * @param {THREE.BufferGeometry} geometry - Water surface geometry
 * @param {number} flowSpeed - Speed of water flow animation (default: 1.0)
 * @param {string} baseColor - Base water color (default: #1a7b9c)
 * @param {string} foamColor - Foam/white water color (default: #ffffff)
 */
export default function FlowingWater({ 
    geometry, 
    flowSpeed = 1.5, 
    baseColor = '#1a7b9c',
    foamColor = '#ffffff'
}) {
    const materialRef = useRef();
    
    // Custom shader material for flowing water effect
    const shaderMaterial = useMemo(() => {
        return new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                flowSpeed: { value: flowSpeed },
                baseColor: { value: new THREE.Color(baseColor) },
                foamColor: { value: new THREE.Color(foamColor) },
                opacity: { value: 0.85 }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vPosition;
                varying float vElevation;
                uniform float time;
                uniform float flowSpeed;
                
                // Simplex noise function for more organic wave motion
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
                
                void main() {
                    vUv = uv;
                    vPosition = position;
                    
                    vec3 pos = position;
                    
                    // Create flowing wave motion
                    // Multiple octaves of noise for complexity
                    float flowTime = time * flowSpeed;
                    
                    // Primary wave - large flowing motion
                    float wave1 = snoise(vec2(pos.x * 0.3, pos.z * 0.3 - flowTime * 0.5)) * 0.15;
                    
                    // Secondary waves - medium choppiness
                    float wave2 = snoise(vec2(pos.x * 0.8, pos.z * 0.8 - flowTime * 0.8)) * 0.08;
                    
                    // Tertiary waves - fine detail rapids
                    float wave3 = snoise(vec2(pos.x * 2.0, pos.z * 2.0 - flowTime * 1.5)) * 0.04;
                    
                    // Turbulent cross-flow for rapids effect
                    float turbulence = snoise(vec2(pos.x * 1.5 + flowTime * 0.3, pos.z * 1.2 - flowTime * 0.7)) * 0.05;
                    
                    float elevation = wave1 + wave2 + wave3 + turbulence;
                    pos.y += elevation;
                    
                    vElevation = elevation;
                    
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 baseColor;
                uniform vec3 foamColor;
                uniform float time;
                uniform float flowSpeed;
                uniform float opacity;
                
                varying vec2 vUv;
                varying vec3 vPosition;
                varying float vElevation;
                
                // Hash function for foam noise
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
                
                // Noise for foam pattern
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
                
                void main() {
                    // Flow-based UV scrolling for texture-like effect
                    vec2 flowUV = vUv;
                    flowUV.y -= time * flowSpeed * 0.3;
                    
                    // Create foam where water is elevated (wave peaks)
                    float foamFactor = smoothstep(0.05, 0.15, vElevation);
                    
                    // Add animated foam noise for white water rapids
                    float foamNoise = noise(flowUV * 10.0 + time * flowSpeed);
                    foamNoise += noise(flowUV * 25.0 - time * flowSpeed * 0.5) * 0.5;
                    
                    // Foam appears at peaks and in turbulent areas
                    float foam = foamFactor * foamNoise;
                    foam += step(0.7, foamNoise) * 0.3; // Additional foam streaks
                    
                    // Mix base water color with foam
                    vec3 waterColor = mix(baseColor, foamColor, clamp(foam, 0.0, 1.0));
                    
                    // Add depth-based darkness (deeper = darker)
                    float depth = smoothstep(-0.1, 0.0, vElevation);
                    waterColor = mix(waterColor * 0.6, waterColor, depth);
                    
                    // Add slight shimmer/reflection
                    float shimmer = noise(flowUV * 15.0 + time * 2.0) * 0.15;
                    waterColor += vec3(shimmer);
                    
                    gl_FragColor = vec4(waterColor, opacity);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
        });
    }, [flowSpeed, baseColor, foamColor]);
    
    // Animate the water by updating the time uniform
    useFrame((state) => {
        if (materialRef.current) {
            materialRef.current.uniforms.time.value = state.clock.elapsedTime;
        }
    });
    
    return (
        <mesh geometry={geometry}>
            <primitive object={shaderMaterial} ref={materialRef} attach="material" />
        </mesh>
    );
}
