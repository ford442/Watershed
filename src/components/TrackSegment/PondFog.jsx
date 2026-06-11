import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBiome } from '../../systems/BiomeSystem';

const GROUND_MIST_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_MIST_FRAGMENT = `
  uniform float time;
  uniform float opacity;
  uniform vec3 tintColor;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv * 3.0;
    uv.x += time * 0.015;
    uv.y += sin(time * 0.07) * 0.3;

    float swirl = fbm(uv);
    float bank = smoothstep(0.35, 0.85, swirl);

    // Radial fade so the bank dissolves toward the edges of the plane.
    float edgeFade = smoothstep(0.5, 0.05, distance(vUv, vec2(0.5)));

    float alpha = bank * edgeFade * opacity;
    gl_FragColor = vec4(tintColor, alpha);
  }
`;

/**
 * PondFog - Temporary dense fog when camera is inside a pond segment, plus a
 * swirling ground-hugging mist bank that sits on the water surface and
 * catches sun/moon color and reacts to weather.
 */
export default function PondFog({ segmentCenter, waterLevel = 0.5 }) {
    const { camera, scene } = useThree();
    const { timeOfDay } = useBiome();
    const originalFogRef = useRef(null);
    const isActiveRef = useRef(false);
    const groundMistRef = useRef();
    const [weatherType, setWeatherType] = useState('clear');

    useEffect(() => {
        const onWeatherUpdate = (event) => {
            const incoming = event?.detail?.type;
            if (typeof incoming === 'string') setWeatherType(incoming);
        };
        window.addEventListener('weather-update', onWeatherUpdate);
        return () => window.removeEventListener('weather-update', onWeatherUpdate);
    }, []);

    useEffect(() => {
        // Store original fog on mount
        originalFogRef.current = scene.fog ? {
            color: scene.fog.color.clone(),
            near: scene.fog.near,
            far: scene.fog.far,
        } : null;
        return () => {
            // Restore original fog on unmount
            if (originalFogRef.current && scene.fog) {
                scene.fog.color.set(originalFogRef.current.color);
                scene.fog.near = originalFogRef.current.near;
                scene.fog.far = originalFogRef.current.far;
            }
        };
    }, [scene]);

    const groundMistMaterial = useMemo(() => new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        uniforms: {
            time: { value: 0 },
            opacity: { value: 0 },
            tintColor: { value: new THREE.Color('#c8d8d0') },
        },
        vertexShader: GROUND_MIST_VERTEX,
        fragmentShader: GROUND_MIST_FRAGMENT,
    }), []);

    useFrame((state) => {
        if (!scene.fog) return;
        const dist = camera.position.distanceTo(segmentCenter);
        const shouldBeActive = dist < 40; // Fog radius
        const stormBlend = weatherType === 'storm' ? 1 : weatherType === 'overcast' ? 0.4 : 0;

        // Tint the dense pond fog toward warm sunset / cool moonlight, and
        // toward a darker grey under storms.
        const dayPhase = Math.abs(timeOfDay - 0.5) * 2;
        const nightFactor = THREE.MathUtils.smoothstep(dayPhase, 0.6, 0.85);
        const sunsetBlend = THREE.MathUtils.smoothstep(timeOfDay, 0.65, 0.9);
        const baseFogColor = new THREE.Color('#c8d8d0');
        if (nightFactor > sunsetBlend) {
            baseFogColor.lerp(new THREE.Color('#7e8fb0'), nightFactor * 0.5);
        } else {
            baseFogColor.lerp(new THREE.Color('#f0c79a'), sunsetBlend * 0.45);
        }
        baseFogColor.lerp(new THREE.Color('#5a6066'), stormBlend * 0.6);

        if (shouldBeActive && !isActiveRef.current) {
            isActiveRef.current = true;
        } else if (!shouldBeActive && isActiveRef.current) {
            isActiveRef.current = false;
            // Restore original
            if (originalFogRef.current) {
                scene.fog.color.set(originalFogRef.current.color);
                scene.fog.near = originalFogRef.current.near;
                scene.fog.far = originalFogRef.current.far;
            }
        }

        if (isActiveRef.current) {
            // Dense pond fog: storms pull it in much closer.
            scene.fog.color.copy(baseFogColor);
            scene.fog.near = stormBlend > 0.5 ? 8 : 15;
            scene.fog.far = stormBlend > 0.5 ? 32 : 50;
        }

        if (groundMistRef.current) {
            groundMistRef.current.position.set(segmentCenter.x, waterLevel + 0.08, segmentCenter.z);
            const targetOpacity = isActiveRef.current ? (0.35 + stormBlend * 0.25) : 0;
            groundMistMaterial.uniforms.opacity.value = THREE.MathUtils.lerp(
                groundMistMaterial.uniforms.opacity.value,
                targetOpacity,
                0.04
            );
            groundMistMaterial.uniforms.time.value = state.clock.elapsedTime;
            groundMistMaterial.uniforms.tintColor.value.copy(baseFogColor);
        }
    });

    return (
        <mesh ref={groundMistRef} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} renderOrder={1}>
            <planeGeometry args={[90, 90, 1, 1]} />
            <primitive object={groundMistMaterial} attach="material" />
        </mesh>
    );
}
