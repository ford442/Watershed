import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';

export default function CreekCanyon() {
    // Procedural generation parameters
    const length = 100;
    const width = 20;
    const segmentsX = 50;
    const segmentsZ = 100;

    // Generate heightmap based geometry
    const geometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(width, length, segmentsX, segmentsZ);

        // Orient the plane to lie flat on the ground (XZ plane)
        // Default PlaneGeometry is on XY plane, so we rotate -90 deg on X
        geo.rotateX(-Math.PI / 2);

        const posAttribute = geo.attributes.position;
        const vertex = new THREE.Vector3();

        for (let i = 0; i < posAttribute.count; i++) {
            vertex.fromBufferAttribute(posAttribute, i);

            // Calculate distance from center (x=0)
            const x = vertex.x;
            const distFromCenter = Math.abs(x);
            const normalizedDist = distFromCenter / (width / 2);

            // Canyon shape logic
            // 0 at center, high at edges
            // Use a power function to create a flat riverbed and steep walls
            let y = Math.pow(normalizedDist, 3) * 15;

            // Add some noise/randomness for natural look
            y += (Math.random() - 0.5) * 0.5;

            // Apply height
            posAttribute.setY(i, y);
        }

        geo.computeVertexNormals();
        return geo;
    }, []);

    return (
        <group>
            {/* Physics Body & Visual Canyon */}
            {/* Using trimesh collider so the physics shape matches the visual mesh exactly */}
            <RigidBody type="fixed" colliders="trimesh">
                <mesh geometry={geometry} receiveShadow castShadow>
                    <meshStandardMaterial
                        color="#4a5d4a" // Darker mossy green/grey
                        roughness={0.9}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            </RigidBody>

            {/* Water Plane */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.0, 0]}>
                <planeGeometry args={[width, length]} />
                <meshStandardMaterial
                    color="#005588"
                    transparent
                    opacity={0.7}
                    roughness={0.2}
                    metalness={0.1}
                />
            </mesh>
        </group>
    );
}
