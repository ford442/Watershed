import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/**
 * WaterfallParticles - High performance falling water effect with dynamic scaling
 * 
 * Features:
 * - Scales particle count based on player velocity (E4)
 * - Base count from segment config density
 * - Smooth fade in/out when transitioning
 * - Caps at 500 particles for performance
 */
export default function WaterfallParticles({ 
    count: baseCount = 300, 
    width = 15, 
    height = 25,
    playerVelocity = 0,
    particleDensity = 1.0, // 0.0-1.0 from segment config
}) {
    const meshRef = useRef();
    const lightRef = useRef();
    const currentCountRef = useRef(baseCount);
    const targetCountRef = useRef(baseCount);
    const fadeAlphaRef = useRef(1.0);

    // Calculate dynamic particle count based on velocity and density (E4)
    const calculatedCount = useMemo(() => {
        // Base count from density (100-400 range)
        const densityBase = 100 + (particleDensity * 300);
        
        // Velocity boost: if > 20 m/s, multiply by 1.5
        let velocityMultiplier = 1.0;
        if (playerVelocity > 20) {
            velocityMultiplier = 1.5;
        }
        
        // Calculate final count
        let finalCount = Math.floor(densityBase * velocityMultiplier);
        
        // Cap at 500 particles max (E4 requirement)
        finalCount = Math.min(500, finalCount);
        
        return finalCount;
    }, [baseCount, particleDensity, playerVelocity]);

    // Update target count when calculated count changes
    useEffect(() => {
        targetCountRef.current = calculatedCount;
    }, [calculatedCount]);

    // Generate particle pool (max 500)
    const particles = useMemo(() => {
        const temp = [];
        for (let i = 0; i < 500; i++) {
            const x = (Math.random() - 0.5) * width;
            const y = Math.random() * height;
            const z = (Math.random() - 0.5) * 5;
            const speed = 0.2 + Math.random() * 0.3;
            const scale = 0.5 + Math.random() * 0.5;

            temp.push({ 
                x, y, z, speed, scale, initialY: y,
                active: i < baseCount // Only active particles are rendered
            });
        }
        return temp;
    }, [width, height, baseCount]);

    // Reusable dummy object for matrix calculations
    const dummy = useMemo(() => new THREE.Object3D(), []);

    useFrame((state, delta) => {
        if (!meshRef.current) return;

        // Smoothly interpolate current count toward target (prevent frame spikes)
        const countDiff = targetCountRef.current - currentCountRef.current;
        if (Math.abs(countDiff) > 1) {
            // Change by max 50 particles per frame to avoid spikes
            const change = Math.sign(countDiff) * Math.min(50, Math.abs(countDiff) * delta * 5);
            currentCountRef.current += change;
        } else {
            currentCountRef.current = targetCountRef.current;
        }

        const currentCount = Math.floor(currentCountRef.current);

        // Fade handling: if player velocity < 1 m/s, fade out over 2s (E4)
        if (playerVelocity < 1.0) {
            fadeAlphaRef.current -= delta * 0.5; // 2s fade out
            if (fadeAlphaRef.current < 0) fadeAlphaRef.current = 0;
        } else {
            fadeAlphaRef.current += delta * 2; // 0.5s fade in
            if (fadeAlphaRef.current > 1) fadeAlphaRef.current = 1;
        }

        // Update particle visibility in material
        if (meshRef.current.material) {
            meshRef.current.material.opacity = 0.6 * fadeAlphaRef.current;
        }

        particles.forEach((p, i) => {
            // Only process active particles
            if (i < currentCount) {
                // Move particle down
                p.y -= p.speed;

                // Reset to top if it hits bottom
                if (p.y < 0) {
                    p.y = height;
                    p.x = (Math.random() - 0.5) * width;
                }

                // Update transform
                dummy.position.set(p.x, p.y, p.z);
                dummy.scale.setScalar(p.scale * fadeAlphaRef.current);
                dummy.rotation.x += 0.05;

                dummy.updateMatrix();
                meshRef.current.setMatrixAt(i, dummy.matrix);
            } else {
                // Hide inactive particles
                dummy.scale.setScalar(0);
                dummy.updateMatrix();
                meshRef.current.setMatrixAt(i, dummy.matrix);
            }
        });

        meshRef.current.instanceMatrix.needsUpdate = true;

        // Flicker light based on active particle count
        if (lightRef.current) {
            const intensityScale = currentCount / 300;
            lightRef.current.intensity = (2 + Math.sin(state.clock.elapsedTime * 10) * 0.5) * intensityScale;
            lightRef.current.intensity *= fadeAlphaRef.current;
        }
    });

    return (
        <group position={[0, -height / 2, 0]}>
            <instancedMesh 
                ref={meshRef} 
                args={[null, null, 500]} // Max 500 particles
                frustumCulled={false}
            >
                <planeGeometry args={[0.8, 0.8]} />
                <meshStandardMaterial
                    color="#e0f7fa"
                    transparent
                    opacity={0.6}
                    roughness={0.1}
                    emissive="#aaddff"
                    emissiveIntensity={0.5}
                    side={THREE.DoubleSide}
                />
            </instancedMesh>

            <pointLight 
                ref={lightRef} 
                distance={20} 
                color="#aaddff" 
                decay={2}
                intensity={2}
            />
        </group>
    );
}
