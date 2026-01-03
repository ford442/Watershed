import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/**
 * TreeSystem - Instanced tree rendering along riverbanks
 * 
 * Generates trees positioned along the river path with natural distribution.
 * Uses instanced rendering for performance with many trees.
 * 
 * @param {THREE.CatmullRomCurve3} riverPath - The river curve from TrackSegment
 * @param {number} trackWidth - Width of the river track
 * @param {number} wallHeight - Height of canyon walls
 */
export default function TreeSystem({ riverPath, trackWidth = 16, wallHeight = 12 }) {
    // Generate tree positions along the riverbank
    const treeData = useMemo(() => {
        if (!riverPath) return [];
        
        const trees = [];
        const numSamples = 50; // Sample points along the path
        const treesPerSide = 3; // Trees per sample point per side
        
        for (let i = 0; i < numSamples; i++) {
            const t = i / numSamples;
            const point = riverPath.getPoint(t);
            const tangent = riverPath.getTangent(t).normalize();
            
            // Calculate perpendicular vector (right vector)
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
            
            // Place trees on both sides of the river
            for (let side = -1; side <= 1; side += 2) {
                for (let j = 0; j < treesPerSide; j++) {
                    // Random offset from wall edge
                    const offsetFromWall = Math.random() * 3 + 1; // 1-4 units from wall
                    const lateralOffset = Math.random() * 2 - 1; // Slight randomness along path
                    
                    const baseDistance = (trackWidth / 2) + offsetFromWall;
                    const position = point.clone()
                        .add(right.clone().multiplyScalar(side * baseDistance))
                        .add(tangent.clone().multiplyScalar(lateralOffset * 5));
                    
                    // Trees sit on top of canyon walls
                    position.y += wallHeight;
                    
                    trees.push({
                        position,
                        scale: 0.5 + Math.random() * 0.5, // Random size 0.5-1.0
                        rotation: Math.random() * Math.PI * 2, // Random rotation
                    });
                }
            }
        }
        
        return trees;
    }, [riverPath, trackWidth, wallHeight]);
    
    // Create instanced mesh refs
    const trunkRef = useRef();
    const foliageRef = useRef();
    
    // Update instance matrices
    useMemo(() => {
        if (!trunkRef.current || !foliageRef.current || treeData.length === 0) return;
        
        const trunkMatrix = new THREE.Matrix4();
        const foliageMatrix = new THREE.Matrix4();
        
        treeData.forEach((tree, i) => {
            const { position, scale, rotation } = tree;
            
            // Trunk (cylinder)
            const trunkHeight = 2 * scale;
            const trunkPos = position.clone();
            trunkMatrix.makeRotationX(Math.PI / 2);
            trunkMatrix.setPosition(trunkPos.x, trunkPos.y + trunkHeight / 2, trunkPos.z);
            const scaleMatrix = new THREE.Matrix4().makeScale(0.2 * scale, 0.2 * scale, trunkHeight);
            trunkMatrix.multiply(scaleMatrix);
            trunkRef.current.setMatrixAt(i, trunkMatrix);
            
            // Foliage (cone)
            const foliagePos = position.clone();
            foliagePos.y += trunkHeight;
            foliageMatrix.makeRotationY(rotation);
            foliageMatrix.setPosition(foliagePos.x, foliagePos.y + 1.5 * scale, foliagePos.z);
            const foliageScaleMatrix = new THREE.Matrix4().makeScale(scale, scale * 1.5, scale);
            foliageMatrix.multiply(foliageScaleMatrix);
            foliageRef.current.setMatrixAt(i, foliageMatrix);
        });
        
        trunkRef.current.instanceMatrix.needsUpdate = true;
        foliageRef.current.instanceMatrix.needsUpdate = true;
    }, [treeData]);
    
    if (treeData.length === 0) return null;
    
    return (
        <group name="tree-system">
            {/* Tree trunks - cylinders */}
            <instancedMesh
                ref={trunkRef}
                args={[null, null, treeData.length]}
                castShadow
                receiveShadow
            >
                <cylinderGeometry args={[0.2, 0.2, 2, 8]} />
                <meshStandardMaterial color="#3d2817" roughness={0.8} />
            </instancedMesh>
            
            {/* Tree foliage - cones */}
            <instancedMesh
                ref={foliageRef}
                args={[null, null, treeData.length]}
                castShadow
                receiveShadow
            >
                <coneGeometry args={[1, 3, 8]} />
                <meshStandardMaterial color="#2d5016" roughness={0.7} />
            </instancedMesh>
        </group>
    );
}
