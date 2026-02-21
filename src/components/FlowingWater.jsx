import React, { useMemo } from 'react';
import * as THREE from 'three';

/**
 * FlowingWater - Simplified water surface (no custom shaders)
 * TEMP: Using meshBasicMaterial to avoid shader compilation errors
 */
export default function FlowingWater({ 
    geometry, 
    flowSpeed = 1.2,
    baseColor = '#1a7b9c',
}) {
    // Simple material - no shader injection
    const material = useMemo(() => {
        return new THREE.MeshBasicMaterial({
            color: new THREE.Color(baseColor),
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
        });
    }, [baseColor]);
    
    return (
        <mesh geometry={geometry} material={material} />
    );
}
