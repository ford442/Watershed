import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useTexture } from '@react-three/drei';

export default function CreekCanyon() {
    // Load rock textures
    const [colorMap, normalMap, roughnessMap, aoMap, displacementMap] = useTexture([
        './Rock031_1K-JPG_Color.jpg',
        './Rock031_1K-JPG_NormalGL.jpg',
        './Rock031_1K-JPG_Roughness.jpg',
        './Rock031_1K-JPG_AmbientOcclusion.jpg',
        './Rock031_1K-JPG_Displacement.jpg',
    ]);

    // Configure texture repeat for more detail
    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap, displacementMap].forEach(texture => {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(4, 8);
        });
    }, [colorMap, normalMap, roughnessMap, aoMap, displacementMap]);

    // Procedural generation parameters
    const length = 100;
    const width = 20;
    const segmentsX = 80;
    const segmentsZ = 160;

    // Generate heightmap based geometry
    const geometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(width, length, segmentsX, segmentsZ);

        // Orient the plane to lie flat on the ground (XZ plane)
        geo.rotateX(-Math.PI / 2);

        const posAttribute = geo.attributes.position;
        const vertex = new THREE.Vector3();

        // Create varied terrain with more natural rock formations
        for (let i = 0; i < posAttribute.count; i++) {
            vertex.fromBufferAttribute(posAttribute, i);

            const x = vertex.x;
            const z = vertex.z;
            const distFromCenter = Math.abs(x);
            const normalizedDist = distFromCenter / (width / 2);

            // Canyon shape - flat riverbed with steep walls
            // Use smoother power curve for more natural canyon walls
            let y = Math.pow(normalizedDist, 2.5) * 12;

            // Add rolling hills along the canyon walls
            const hillNoise = Math.sin(z * 0.15) * Math.cos(x * 0.3) * 1.5;
            y += hillNoise * normalizedDist;

            // Add rocky texture variation
            const rockNoise = Math.sin(z * 0.8 + x * 0.5) * 0.3 +
                              Math.sin(z * 1.5 - x * 0.8) * 0.2 +
                              Math.sin(z * 2.5 + x * 1.2) * 0.1;
            y += rockNoise * (0.5 + normalizedDist);

            // Slight slope downward along Z for natural water flow
            y -= z * 0.02;

            // Small random variation for natural roughness
            y += (Math.random() - 0.5) * 0.2;

            posAttribute.setY(i, y);
        }

        // Add UV2 attribute for ambient occlusion map
        geo.setAttribute('uv2', geo.attributes.uv.clone());

        geo.computeVertexNormals();
        return geo;
    }, []);

    return (
        <group>
            {/* Physics Body & Visual Canyon */}
            <RigidBody type="fixed" colliders="trimesh">
                <mesh geometry={geometry} receiveShadow castShadow>
                    <meshStandardMaterial
                        map={colorMap}
                        normalMap={normalMap}
                        normalScale={new THREE.Vector2(1.2, 1.2)}
                        roughnessMap={roughnessMap}
                        aoMap={aoMap}
                        aoMapIntensity={0.8}
                        displacementMap={displacementMap}
                        displacementScale={0.3}
                        side={THREE.DoubleSide}
                        envMapIntensity={0.5}
                    />
                </mesh>
            </RigidBody>

            {/* Water Plane - more realistic rushing water appearance */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.8, 0]}>
                <planeGeometry args={[width * 0.4, length]} />
                <meshStandardMaterial
                    color="#1a6b8a"
                    transparent
                    opacity={0.75}
                    roughness={0.1}
                    metalness={0.3}
                    envMapIntensity={1.0}
                />
            </mesh>

            {/* Secondary water layer for depth effect */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6, 0]}>
                <planeGeometry args={[width * 0.35, length]} />
                <meshStandardMaterial
                    color="#0d4a5e"
                    transparent
                    opacity={0.5}
                    roughness={0.2}
                    metalness={0.2}
                />
            </mesh>
        </group>
    );
}
