import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sky, Stars, Cloud, Environment } from '@react-three/drei';
import * as THREE from 'three';

// Atmospheric presets
const BIOME_SETTINGS = {
    summer: {
        sunPosition: [100, 20, 100],
        fogColor: '#cce0ff',
        fogDensity: 0.015,
        turbidity: 8,
        rayleigh: 6
    },
    autumn: {
        sunPosition: [100, 10, 50], // Lower sun, more golden hour
        fogColor: '#ffebd6', // Warm haze
        fogDensity: 0.02,    // Thicker atmosphere
        turbidity: 10,
        rayleigh: 3
    }
};

export default function EnhancedSky({ biome = 'summer' }) {
    const cloudRef = useRef();
    
    // Get target settings based on current biome
    const target = BIOME_SETTINGS[biome] || BIOME_SETTINGS.summer;

    // We use a ref to store current values for smooth interpolation
    const current = useRef({
        fogColor: new THREE.Color(target.fogColor),
        fogDensity: target.fogDensity
    });

    useFrame((state, delta) => {
        // Animate clouds
        if (cloudRef.current) {
            cloudRef.current.rotation.y += delta * 0.02;
        }

        // Guard clause to prevent crash on initial frames
        if (!state.scene.fog) return;

        // Smoothly interpolate Fog
        const step = delta * 0.5; // Transition speed

        // Lerp density
        state.scene.fog.density = THREE.MathUtils.lerp(
            state.scene.fog.density,
            target.fogDensity,
            step
        );

        // Lerp color
        current.current.fogColor.lerp(new THREE.Color(target.fogColor), step);
        state.scene.fog.color.copy(current.current.fogColor);
        state.scene.background = current.current.fogColor; // Match background to fog
    });

    return (
        <group>
            {/* Dynamic Sky */}
            <Sky
                distance={450000}
                sunPosition={target.sunPosition}
                inclination={0}
                azimuth={0.25}
                turbidity={target.turbidity}
                rayleigh={target.rayleigh}
            />
            
            {/* Stars for depth (mostly visible if we darkened the sky) */}
            <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
            
            {/* Distant Clouds */}
            <group position={[0, 40, -100]} ref={cloudRef}>
                 <Cloud opacity={0.5} speed={0.4} width={50} depth={5} segments={20} />
            </group>

            {/* Global Lighting & Reflections */}
            <Environment preset="forest" />

            {/* Fog is attached to the scene via <fog /> primitive in React Three Fiber */}
            <fog attach="fog" args={['#cce0ff', 0.015]} />
        </group>
    );
}
