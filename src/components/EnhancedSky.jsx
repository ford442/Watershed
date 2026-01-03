import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Sky } from '@react-three/drei';

/**
 * EnhancedSky - Improved atmospheric sky for canyon environments
 * 
 * Provides better lighting and atmosphere than the basic Sky component.
 * Tuned for desert/rocky canyon aesthetics with warm sunlight and depth.
 * 
 * Features:
 * - Optimized sun position for dramatic canyon lighting
 * - Atmospheric fog for depth perception
 * - Warm color palette suitable for creek canyon biome
 */
export default function EnhancedSky() {
    // Sun position - high and to the side for dramatic canyon shadows
    // Using Sky component's coordinate system where Y is up
    const sunPosition = useMemo(() => new THREE.Vector3(100, 20, 100), []);
    
    return (
        <group name="enhanced-sky">
            {/* Enhanced Sky component */}
            <Sky
                distance={450000}
                sunPosition={sunPosition}
                inclination={0.6}
                azimuth={0.25}
                mieCoefficient={0.005}
                mieDirectionalG={0.8}
                rayleigh={0.5}
                turbidity={10}
            />
            
            {/* Atmospheric fog for depth - warm desert tones */}
            <fog attach="fog" args={['#d4b896', 50, 300]} />
            
            {/* Additional ambient color tinting for warm canyon atmosphere */}
            <hemisphereLight
                args={['#f4e4c1', '#8b7355', 0.4]}
                position={[0, 50, 0]}
            />
            
            {/* Rim light to highlight canyon walls from above */}
            <directionalLight
                position={[0, 50, -50]}
                intensity={0.3}
                color="#ffd89b"
            />
        </group>
    );
}
