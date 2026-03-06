import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
import * as THREE from 'three';

// Atmospheric presets
const BIOME_SETTINGS = {
    summer: {
        sunPosition: [100, 20, 100],
        fogColor: '#b8d4f0',
        fogDensity: 0.012,
        turbidity: 7,
        rayleigh: 5,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.8,
    },
    autumn: {
        sunPosition: [100, 10, 50], // Lower sun, golden hour
        fogColor: '#e8c89a',        // Warm amber haze
        fogDensity: 0.018,          // Thicker, duskier atmosphere
        turbidity: 12,
        rayleigh: 2,
        mieCoefficient: 0.008,
        mieDirectionalG: 0.85,
    }
};

export default function EnhancedSky({ biome = 'summer' }) {
    const target = BIOME_SETTINGS[biome] || BIOME_SETTINGS.summer;
    const fogRef = useRef();

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
            <Sky
                distance={450000}
                sunPosition={target.sunPosition}
                inclination={0}
                azimuth={0.25}
                turbidity={target.turbidity}
                rayleigh={target.rayleigh}
                mieCoefficient={target.mieCoefficient}
                mieDirectionalG={target.mieDirectionalG}
            />

            {/* Stars - subtle backdrop depth */}
            <Stars radius={150} depth={60} count={3000} factor={3} saturation={0} fade speed={0.5} />

            {/* Cloud and Environment components removed - were causing asset loading errors */}

            {/* Exponential fog: ref allows density/color to be updated each frame without
                recreating the scene fog object. Initial args match the starting biome. */}
            <fogExp2 ref={fogRef} attach="fog" args={[target.fogColor, target.fogDensity]} />
        </group>
    );
}
