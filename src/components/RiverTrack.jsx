import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useTexture } from '@react-three/drei';

export default function RiverTrack() {
    // 1. Load Textures from public folder
    const [colorMap, normalMap, roughnessMap, aoMap, displacementMap] = useTexture([
        './Rock031_1K-JPG_Color.jpg',
        './Rock031_1K-JPG_NormalGL.jpg',
        './Rock031_1K-JPG_Roughness.jpg',
        './Rock031_1K-JPG_AmbientOcclusion.jpg',
        './Rock031_1K-JPG_Displacement.jpg',
    ]);

    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap, displacementMap].forEach(t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(4, 30);
        });
    }, [colorMap, normalMap, roughnessMap, aoMap, displacementMap]);

    // 2. Define the "Spine" (Path) with a Safe Start
    const riverPath = useMemo(() => {
        return new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),       // START
            new THREE.Vector3(0, 0, -20),     // SAFE ZONE: 20m of straight, flat track
            new THREE.Vector3(10, -5, -70),   // BEGIN DROP: Curve right and down
            new THREE.Vector3(-20, -20, -120),// HARD TURN: Left
            new THREE.Vector3(0, -40, -180),  // RECENTER
            new THREE.Vector3(0, -50, -250)   // END
        ], false, 'catmullrom', 0.5);
    }, []);

    // 3. Define the "Cross Section" (Shape)
    const riverShape = useMemo(() => {
        const shape = new THREE.Shape();
        const width = 12; // Slightly wider for safety
        const height = 15;

        // Draw U-shape (Counter-Clockwise)
        shape.moveTo(-width, height);
        shape.lineTo(-width * 0.6, 0); // Left Bank
        shape.lineTo(width * 0.6, 0);  // River Bed
        shape.lineTo(width, height);   // Right Bank

        return shape;
    }, []);

    // 4. Generate Geometry
    const geometry = useMemo(() => {
        const extrudeSettings = {
            steps: 120, // Higher resolution for smoother curves
            curveSegments: 12,
            extrudePath: riverPath,
        };

        const geo = new THREE.ExtrudeGeometry(riverShape, extrudeSettings);
        geo.computeVertexNormals();
        return geo;
    }, [riverPath, riverShape]);

    // 5. Water Geometry
    const waterGeometry = useMemo(() => {
        return new THREE.TubeGeometry(riverPath, 120, 5, 2, false);
    }, [riverPath]);

    return (
        <group>
            {/* Physics Body: "trimesh" matches the complex shape exactly */}
            <RigidBody type="fixed" colliders="trimesh" friction={1}>
                <mesh geometry={geometry} receiveShadow castShadow>
                    <meshStandardMaterial
                        map={colorMap}
                        normalMap={normalMap}
                        roughnessMap={roughnessMap}
                        aoMap={aoMap}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            </RigidBody>

            {/* Visual Water Surface */}
            <mesh geometry={waterGeometry} position={[0, 1, 0]} scale={[1, 0.05, 1]}>
                <meshStandardMaterial
                    color="#1a6b8a"
                    transparent
                    opacity={0.8}
                    roughness={0.0}
                    metalness={0.9}
                    side={THREE.DoubleSide}
                />
            </mesh>
        </group>
    );
}
