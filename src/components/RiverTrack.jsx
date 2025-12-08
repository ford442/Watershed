
import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useTexture } from '@react-three/drei';

export default function RiverTrack() {
    // 1. Reuse your textures
    const [colorMap, normalMap, roughnessMap, aoMap, displacementMap] = useTexture([
        '/Rock031_1K-JPG_Color.jpg',
        '/Rock031_1K-JPG_NormalGL.jpg',
        '/Rock031_1K-JPG_Roughness.jpg',
        '/Rock031_1K-JPG_AmbientOcclusion.jpg',
        '/Rock031_1K-JPG_Displacement.jpg',
    ]);

    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap, displacementMap].forEach(t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(4, 20); // Repeat more along the length (Y)
        });
    }, [colorMap, normalMap, roughnessMap, aoMap, displacementMap]);

    // 2. Define the "Spine" of the river (The Path)
    // This creates a long, winding path downhill.
    const riverPath = useMemo(() => {
        return new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),        // Start
            new THREE.Vector3(10, -5, -50),    // Slight right turn, drop
            new THREE.Vector3(-20, -15, -100), // Hard left, steeper drop
            new THREE.Vector3(0, -30, -150),   // Back to center
            new THREE.Vector3(0, -40, -200)    // End
        ], false, 'catmullrom', 0.5);
    }, []);

    // 3. Define the "Cross Section" (The Shape)
    // Think of this as a slice of the canyon looking down the barrel.
    const riverShape = useMemo(() => {
        const shape = new THREE.Shape();
        const width = 10;
        const height = 15;

        // Draw a "U" shape
        // Start top left
        shape.moveTo(-width, height);
        // Down to river bed left
        shape.lineTo(-width * 0.5, 0);
        // Across river bed
        shape.lineTo(width * 0.5, 0);
        // Up to top right
        shape.lineTo(width, height);

        return shape;
    }, []);

    // 4. Generate the Geometry
    const geometry = useMemo(() => {
        const steps = 100; // Resolution of the curve
        const extrudeSettings = {
            steps: steps,
            curveSegments: 10,
            extrudePath: riverPath,
            UVGenerator: undefined // Default UVs might need tweaking later
        };

        const geo = new THREE.ExtrudeGeometry(riverShape, extrudeSettings);

        // Center geometry helps with physics alignment sometimes, 
        // but for a track, we usually keep it relative to world origin (0,0,0).
        geo.computeVertexNormals();
        return geo;
    }, [riverPath, riverShape]);

    return (
        <group>
            {/* The Canyon Walls & Bed */}
            <RigidBody type="fixed" colliders="trimesh">
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

            {/* The Water */}
            {/* For the water, we can use a simpler TubeGeometry or Ribbon 
               that follows the same `riverPath` but is slightly offset in Y (height).
            */}
            <WaterSurface path={riverPath} />
        </group>
    );
}

// Helper component to render the water surface along the same path
function WaterSurface({ path }) {
    const geometry = useMemo(() => {
        // Create a flat ribbon for water
        const tube = new THREE.TubeGeometry(path, 100, 4, 2, false);
        // Note: TubeGeometry makes a cylinder. For a flat river, 
        // we might just want to use the ExtrudeGeometry again with a flat line shape.
        // For simplicity here, we'll scale a tube to look flat.
        return tube;
    }, [path]);

    return (
        <mesh geometry={geometry} position={[0, 0.5, 0]} scale={[1, 0.1, 1]}>
            <meshStandardMaterial
                color="#1a6b8a"
                transparent
                opacity={0.8}
                roughness={0.1}
                metalness={0.8}
            />
        </mesh>
    );
}
