import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useTexture } from '@react-three/drei';

export default function RiverTrack() {
    // 1. Load Textures from public folder
    const [colorMap, normalMap, roughnessMap, aoMap] = useTexture([
        '/Rock031_1K-JPG_Color.jpg',
        '/Rock031_1K-JPG_NormalGL.jpg',
        '/Rock031_1K-JPG_Roughness.jpg',
        '/Rock031_1K-JPG_AmbientOcclusion.jpg',
    ]);

    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap].forEach(t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(10, 50);
        });
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    // 2. Define the path for the river
    const riverPath = useMemo(() => {
        return new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -30),
            new THREE.Vector3(10, -5, -80),
            new THREE.Vector3(-15, -15, -140),
            new THREE.Vector3(0, -30, -200),
            new THREE.Vector3(0, -40, -260)
        ], false, 'catmullrom', 0.5);
    }, []);

    // Track dimensions
    const trackWidth = 16;
    const wallHeight = 12;
    const numSegments = 100;

    // 3. Generate floor geometry by sampling points along the path
    const floorGeometry = useMemo(() => {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const uvs = [];
        const indices = [];

        for (let i = 0; i <= numSegments; i++) {
            const t = i / numSegments;
            const point = riverPath.getPoint(t);
            const tangent = riverPath.getTangent(t).normalize();
            
            // Calculate perpendicular vector (right vector)
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
            
            // Left and right edge points
            const leftPoint = point.clone().add(right.clone().multiplyScalar(-trackWidth / 2));
            const rightPoint = point.clone().add(right.clone().multiplyScalar(trackWidth / 2));

            vertices.push(leftPoint.x, leftPoint.y, leftPoint.z);
            vertices.push(rightPoint.x, rightPoint.y, rightPoint.z);

            uvs.push(0, t * 10);
            uvs.push(1, t * 10);

            if (i < numSegments) {
                const baseIndex = i * 2;
                indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
                indices.push(baseIndex + 1, baseIndex + 3, baseIndex + 2);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return geometry;
    }, [riverPath]);

    // 4. Generate wall geometries
    const leftWallGeometry = useMemo(() => {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const uvs = [];
        const indices = [];

        for (let i = 0; i <= numSegments; i++) {
            const t = i / numSegments;
            const point = riverPath.getPoint(t);
            const tangent = riverPath.getTangent(t).normalize();
            
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
            
            const basePoint = point.clone().add(right.clone().multiplyScalar(-trackWidth / 2));
            const topPoint = basePoint.clone().add(new THREE.Vector3(0, wallHeight, 0));

            vertices.push(basePoint.x, basePoint.y, basePoint.z);
            vertices.push(topPoint.x, topPoint.y, topPoint.z);

            uvs.push(0, t * 10);
            uvs.push(1, t * 10);

            if (i < numSegments) {
                const baseIndex = i * 2;
                indices.push(baseIndex, baseIndex + 2, baseIndex + 1);
                indices.push(baseIndex + 1, baseIndex + 2, baseIndex + 3);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return geometry;
    }, [riverPath]);

    const rightWallGeometry = useMemo(() => {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const uvs = [];
        const indices = [];

        for (let i = 0; i <= numSegments; i++) {
            const t = i / numSegments;
            const point = riverPath.getPoint(t);
            const tangent = riverPath.getTangent(t).normalize();
            
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
            
            const basePoint = point.clone().add(right.clone().multiplyScalar(trackWidth / 2));
            const topPoint = basePoint.clone().add(new THREE.Vector3(0, wallHeight, 0));

            vertices.push(basePoint.x, basePoint.y, basePoint.z);
            vertices.push(topPoint.x, topPoint.y, topPoint.z);

            uvs.push(0, t * 10);
            uvs.push(1, t * 10);

            if (i < numSegments) {
                const baseIndex = i * 2;
                indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
                indices.push(baseIndex + 1, baseIndex + 3, baseIndex + 2);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return geometry;
    }, [riverPath]);

    // 5. Water geometry
    const waterGeometry = useMemo(() => {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const uvs = [];
        const indices = [];
        const waterWidth = trackWidth * 0.7;

        for (let i = 0; i <= numSegments; i++) {
            const t = i / numSegments;
            const point = riverPath.getPoint(t);
            const tangent = riverPath.getTangent(t).normalize();
            
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
            
            const leftPoint = point.clone().add(right.clone().multiplyScalar(-waterWidth / 2));
            const rightPoint = point.clone().add(right.clone().multiplyScalar(waterWidth / 2));
            
            // Raise water slightly above floor
            leftPoint.y += 0.3;
            rightPoint.y += 0.3;

            vertices.push(leftPoint.x, leftPoint.y, leftPoint.z);
            vertices.push(rightPoint.x, rightPoint.y, rightPoint.z);

            uvs.push(0, t * 10);
            uvs.push(1, t * 10);

            if (i < numSegments) {
                const baseIndex = i * 2;
                indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
                indices.push(baseIndex + 1, baseIndex + 3, baseIndex + 2);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return geometry;
    }, [riverPath]);

    return (
        <group>
            {/* Floor */}
            <RigidBody type="fixed" colliders="trimesh" friction={1}>
                <mesh geometry={floorGeometry} receiveShadow>
                    <meshStandardMaterial
                        map={colorMap}
                        normalMap={normalMap}
                        roughnessMap={roughnessMap}
                        aoMap={aoMap}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            </RigidBody>

            {/* Left Wall */}
            <RigidBody type="fixed" colliders="trimesh" friction={0.5}>
                <mesh geometry={leftWallGeometry} receiveShadow castShadow>
                    <meshStandardMaterial
                        map={colorMap}
                        normalMap={normalMap}
                        roughnessMap={roughnessMap}
                        aoMap={aoMap}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            </RigidBody>

            {/* Right Wall */}
            <RigidBody type="fixed" colliders="trimesh" friction={0.5}>
                <mesh geometry={rightWallGeometry} receiveShadow castShadow>
                    <meshStandardMaterial
                        map={colorMap}
                        normalMap={normalMap}
                        roughnessMap={roughnessMap}
                        aoMap={aoMap}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            </RigidBody>

            {/* Water Surface */}
            <mesh geometry={waterGeometry}>
                <meshStandardMaterial
                    color="#1a7b9c"
                    transparent
                    opacity={0.7}
                    roughness={0.1}
                    metalness={0.8}
                    side={THREE.DoubleSide}
                />
            </mesh>
        </group>
    );
}
