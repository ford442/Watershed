import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
import * as THREE from 'three';

// Atmospheric presets – tuned to complement the improved water surface
const BIOME_SETTINGS = {
    summer: {
        sunPosition: [100, 28, 100],    // Slightly higher sun for crisper canyon light
        fogColor: '#b0cfea',             // Cooler blue-grey haze, closer to water palette
        fogDensity: 0.010,               // Slightly lighter fog for better depth readability
        turbidity: 6,                    // Less haze – cleaner alpine sky
        rayleigh: 4,                     // Balanced sky scattering
        mieCoefficient: 0.004,
        mieDirectionalG: 0.82,
    },
    autumn: {
        sunPosition: [100, 12, 50],      // Low golden-hour sun
        fogColor: '#dfc08e',             // Warm amber haze, less saturated to sit with water
        fogDensity: 0.016,               // Slight reduction for better canyon readability
        turbidity: 10,                   // Reduced from 12 – less muddy sky
        rayleigh: 2.5,
        mieCoefficient: 0.007,
        mieDirectionalG: 0.86,
    }
};

export default function EnhancedSky({ biome = 'summer', timeOfDay = 0.25 }) {
    const target = BIOME_SETTINGS[biome] || BIOME_SETTINGS.summer;
    const fogRef = useRef();
    const showStars = biome === 'autumn' ? (timeOfDay < 0.18 || timeOfDay > 0.82) : timeOfDay < 0.12;

    // Store smoothly interpolated state
    const current = useRef({
        fogColor: new THREE.Color(target.fogColor),
        fogDensity: target.fogDensity,
    });

    useFrame((state, delta) => {
        const step = Math.min(1.0, delta * 0.8); // Smooth biome transition

        // Lerp fog color and density toward target
        current.current.fogColor.lerp(new THREE.Color(target.fogColor), step);
        current.current.fogDensity += (target.fogDensity - current.current.fogDensity) * step;

        // Update the fog object directly to avoid recreating the component
        if (fogRef.current) {
            fogRef.current.color.copy(current.current.fogColor);
            fogRef.current.density = current.current.fogDensity;
        }

        // Keep scene background in sync with fog horizon color
        if (state.scene.background instanceof THREE.Color) {
            state.scene.background.copy(current.current.fogColor);
        }
    });

    return (
        <group>
            {/* Physically-based sky */}
            {showStars && (
                <Stars
                    ref={fogRef}
                    radius={100}
                    depth={40}
                    count={biome === 'summer' ? 600 : 1200}
                    factor={biome === 'summer' ? 3.5 : 4.5}
                    saturation={0}
                    fade
                    speed={0.8}
                />
            )}

            {/* Cloud and Environment components removed - were causing asset loading errors */}

            {/* Exponential fog: ref allows density/color to be updated each frame without
                recreating the scene fog object. Initial args match the starting biome. */}
            <fogExp2 ref={fogRef} attach="fog" args={[target.fogColor, target.fogDensity]} />
        </group>
    );
}
