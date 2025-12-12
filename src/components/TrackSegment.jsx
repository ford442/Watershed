import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useTexture } from '@react-three/drei';
import FlowingWater from './FlowingWater';

/**
 * TrackSegment - A single segment of the river track
 * Creates a simple channel using basic geometry for reliable physics
 * 
 * @param {THREE.Vector3[]} pathPoints - Array of Vector3 points defining the spline path
 * @param {number} segmentId - Unique identifier for this segment
 */
export default function TrackSegment({ pathPoints, segmentId = 0 }) {
    // Load Textures from public folder
    const [colorMap, normalMap, roughnessMap, aoMap] = useTexture([
        '/Rock031_1K-JPG_Color.jpg',
        '/Rock031_1K-JPG_NormalGL.jpg',
        '/Rock031_1K-JPG_Roughness.jpg',
        '/Rock031_1K-JPG_AmbientOcclusion.jpg',
    ]);

    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap].forEach(t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(2, 8);
        });
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    // Create the spline path from provided points
    const segmentPath = useMemo(() => {
        return new THREE.CatmullRomCurve3(pathPoints, false, 'catmullrom', 0.5);
    }, [pathPoints]);

    // Calculate path length for proper sizing
    const pathLength = useMemo(() => segmentPath.getLength(), [segmentPath]);

    // Channel dimensions
    const channelWidth = 12;
    const wallHeight = 10;

    // Generate floor geometry - a plane along the path
    const floorGeometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(channelWidth, pathLength, 10, 60);
        geo.rotateX(-Math.PI / 2); // Lay flat
        
        // Deform to follow path
        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            
            // Map z from [-pathLength/2, pathLength/2] to [0, 1] for path sampling
            const t = (z + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));
            
            positions.setX(i, point.x + x);
            positions.setY(i, point.y);
            positions.setZ(i, point.z);
        }
        
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength]);

    // Generate wall geometries
    const leftWallGeometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(wallHeight, pathLength, 1, 60);
        geo.rotateY(Math.PI / 2); // Face inward
        
        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const y = positions.getY(i);
            const z = positions.getZ(i);
            
            const t = (z + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));
            
            positions.setX(i, point.x - channelWidth / 2);
            positions.setY(i, point.y + y + wallHeight / 2);
            positions.setZ(i, point.z);
        }
        
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength]);

    const rightWallGeometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(wallHeight, pathLength, 1, 60);
        geo.rotateY(-Math.PI / 2); // Face inward
        
        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const y = positions.getY(i);
            const z = positions.getZ(i);
            
            const t = (z + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));
            
            positions.setX(i, point.x + channelWidth / 2);
            positions.setY(i, point.y + y + wallHeight / 2);
            positions.setZ(i, point.z);
        }
        
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength]);

    // Water plane
    const waterGeometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(channelWidth * 0.8, pathLength, 10, 60);
        geo.rotateX(-Math.PI / 2);
        
        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            
            const t = (z + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));
            
            positions.setX(i, point.x + x);
            positions.setY(i, point.y + 0.3); // Slightly above floor
            positions.setZ(i, point.z);
        }
        
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength]);

    const rockMaterial = (
        <meshStandardMaterial
            map={colorMap}
            normalMap={normalMap}
            roughnessMap={roughnessMap}
            aoMap={aoMap}
            side={THREE.DoubleSide}
        />
    );

    return (
        <group name={`track-segment-${segmentId}`}>
            {/* Floor */}
            <RigidBody type="fixed" colliders="trimesh" friction={1}>
                <mesh geometry={floorGeometry} receiveShadow>
                    {rockMaterial}
                </mesh>
            </RigidBody>

            {/* Left Wall */}
            <RigidBody type="fixed" colliders="trimesh" friction={0.5}>
                <mesh geometry={leftWallGeometry} receiveShadow castShadow>
                    {rockMaterial}
                </mesh>
            </RigidBody>

            {/* Right Wall */}
            <RigidBody type="fixed" colliders="trimesh" friction={0.5}>
                <mesh geometry={rightWallGeometry} receiveShadow castShadow>
                    {rockMaterial}
                </mesh>
            </RigidBody>

            {/* Water Surface - Flowing Creek */}
            <FlowingWater 
                geometry={waterGeometry}
                flowSpeed={1.5}
                baseColor="#1a6b8a"
                foamColor="#e8f4f8"
            />
        </group>
    );
}
