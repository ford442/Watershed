import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * PondFog — Temporary dense fog when camera is inside a pond segment (Goal 3)
 */
export default function PondFog({ segmentCenter }) {
    const { camera, scene } = useThree();
    const originalFogRef = useRef(null);
    const isActiveRef = useRef(false);

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

    useFrame(() => {
        if (!scene.fog) return;
        const dist = camera.position.distanceTo(segmentCenter);
        const shouldBeActive = dist < 40; // Fog radius

        if (shouldBeActive && !isActiveRef.current) {
            isActiveRef.current = true;
            // Dense pond fog: near=15, far=50 (Goal 3: fog 0.8 feel)
            scene.fog.color.set('#c8d8d0');
            scene.fog.near = 15;
            scene.fog.far = 50;
        } else if (!shouldBeActive && isActiveRef.current) {
            isActiveRef.current = false;
            // Restore original
            if (originalFogRef.current) {
                scene.fog.color.set(originalFogRef.current.color);
                scene.fog.near = originalFogRef.current.near;
                scene.fog.far = originalFogRef.current.far;
            }
        }
    });

    return null;
}
