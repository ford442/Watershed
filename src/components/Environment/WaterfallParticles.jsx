import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/**
 * WaterfallParticles - High performance falling water effect
 * Uses InstancedMesh to render hundreds of particles with a single draw call.
 */
export default function WaterfallParticles({ count = 300, width = 15, height = 25 }) {
    const meshRef = useRef();
    const lightRef = useRef();

    // Generate initial random positions for particles
    const particles = useMemo(() => {
        const temp = [];
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * width;
            const y = Math.random() * height;
            const z = (Math.random() - 0.5) * 5; // Depth thickness
            const speed = 0.2 + Math.random() * 0.3;
            const scale = 0.5 + Math.random() * 0.5;

            temp.push({ x, y, z, speed, scale, initialY: y });
        }
        return temp;
    }, [count, width, height]);

    // Reusable dummy object for matrix calculations (avoids GC)
    const dummy = useMemo(() => new THREE.Object3D(), []);

    useFrame((state) => {
        if (!meshRef.current) return;

        particles.forEach((p, i) => {
            // Move particle down
            p.y -= p.speed;

            // Reset to top if it hits bottom
            if (p.y < 0) {
                p.y = height;
                p.x = (Math.random() - 0.5) * width; // Re-randomize X slightly
            }

            // Update dummy object transform
            dummy.position.set(p.x, p.y, p.z);
            dummy.scale.setScalar(p.scale);
            dummy.rotation.x += 0.05; // Tumble effect

            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
        });

        meshRef.current.instanceMatrix.needsUpdate = true;

        // Flicker light to simulate light catching water spray
        if (lightRef.current) {
            lightRef.current.intensity = 2 + Math.sin(state.clock.elapsedTime * 10) * 0.5;
        }
    });

    return (
        <group position={[0, -height / 2, 0]}> {/* Center the system */}
            <instancedMesh ref={meshRef} args={[null, null, count]}>
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

            {/* Local point light to make the spray glow */}
            <pointLight ref={lightRef} distance={20} color="#aaddff" decay={2} />
        </group>
    );
}
