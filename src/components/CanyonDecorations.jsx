import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';

/**
 * CanyonDecorations - Rocks, boulders, and vegetation along canyon walls
 * 
 * Adds visual detail to the canyon environment with:
 * - Large boulders on canyon floor
 * - Smaller rocks scattered on walls
 * - Vegetation patches (bushes/grass clusters)
 * 
 * Uses instanced rendering for performance.
 * 
 * @param {THREE.CatmullRomCurve3} riverPath - The river curve (can also accept segmentPath from TrackSegment)
 * @param {number} trackWidth - Width of the river track
 * @param {number} wallHeight - Height of canyon walls
 */
export default function CanyonDecorations({ riverPath, trackWidth = 16, wallHeight = 12 }) {
    // Generate decoration positions
    const decorationData = useMemo(() => {
        if (!riverPath) return { boulders: [], rocks: [], vegetation: [] };
        
        const boulders = [];
        const rocks = [];
        const vegetation = [];
        const numSamples = 40;
        
        for (let i = 0; i < numSamples; i++) {
            const t = i / numSamples;
            const point = riverPath.getPoint(t);
            const tangent = riverPath.getTangent(t).normalize();
            
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
            
            // Large boulders near river edges
            for (let side = -1; side <= 1; side += 2) {
                if (Math.random() > 0.7) { // 30% chance
                    const lateralOffset = (trackWidth / 2) * 0.7 + Math.random() * 2;
                    const position = point.clone()
                        .add(right.clone().multiplyScalar(side * lateralOffset))
                        .add(tangent.clone().multiplyScalar((Math.random() - 0.5) * 3));
                    
                    boulders.push({
                        position,
                        scale: 0.8 + Math.random() * 1.2, // 0.8-2.0
                        rotation: [
                            Math.random() * 0.5,
                            Math.random() * Math.PI * 2,
                            Math.random() * 0.5
                        ],
                    });
                }
                
                // Rocks on canyon walls
                const numWallRocks = Math.floor(Math.random() * 3) + 1;
                for (let j = 0; j < numWallRocks; j++) {
                    const wallOffset = (trackWidth / 2) + Math.random() * 1;
                    const heightOnWall = Math.random() * wallHeight * 0.8;
                    const position = point.clone()
                        .add(right.clone().multiplyScalar(side * wallOffset))
                        .add(tangent.clone().multiplyScalar((Math.random() - 0.5) * 5));
                    position.y += heightOnWall;
                    
                    rocks.push({
                        position,
                        scale: 0.2 + Math.random() * 0.4, // Small rocks
                        rotation: [
                            Math.random() * Math.PI,
                            Math.random() * Math.PI * 2,
                            Math.random() * Math.PI
                        ],
                    });
                }
                
                // Vegetation patches on canyon floor edges
                if (Math.random() > 0.6) { // 40% chance
                    const vegOffset = (trackWidth / 2) * 0.8 + Math.random() * 1.5;
                    const position = point.clone()
                        .add(right.clone().multiplyScalar(side * vegOffset))
                        .add(tangent.clone().multiplyScalar((Math.random() - 0.5) * 4));
                    
                    vegetation.push({
                        position,
                        scale: 0.4 + Math.random() * 0.6, // 0.4-1.0
                        rotation: Math.random() * Math.PI * 2,
                    });
                }
            }
        }
        
        return { boulders, rocks, vegetation };
    }, [riverPath, trackWidth, wallHeight]);
    
    // Refs for instanced meshes
    const bouldersRef = useRef();
    const rocksRef = useRef();
    const vegetationRef = useRef();
    
    // Update instance matrices
    useMemo(() => {
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        
        // Update boulders
        if (bouldersRef.current && decorationData.boulders.length > 0) {
            decorationData.boulders.forEach((boulder, i) => {
                position.copy(boulder.position);
                quaternion.setFromEuler(new THREE.Euler(...boulder.rotation));
                scale.set(boulder.scale, boulder.scale * 0.8, boulder.scale);
                matrix.compose(position, quaternion, scale);
                bouldersRef.current.setMatrixAt(i, matrix);
            });
            bouldersRef.current.instanceMatrix.needsUpdate = true;
        }
        
        // Update rocks
        if (rocksRef.current && decorationData.rocks.length > 0) {
            decorationData.rocks.forEach((rock, i) => {
                position.copy(rock.position);
                quaternion.setFromEuler(new THREE.Euler(...rock.rotation));
                scale.set(rock.scale, rock.scale, rock.scale);
                matrix.compose(position, quaternion, scale);
                rocksRef.current.setMatrixAt(i, matrix);
            });
            rocksRef.current.instanceMatrix.needsUpdate = true;
        }
        
        // Update vegetation
        if (vegetationRef.current && decorationData.vegetation.length > 0) {
            decorationData.vegetation.forEach((veg, i) => {
                position.copy(veg.position);
                quaternion.setFromEuler(new THREE.Euler(0, veg.rotation, 0));
                scale.set(veg.scale, veg.scale * 0.6, veg.scale);
                matrix.compose(position, quaternion, scale);
                vegetationRef.current.setMatrixAt(i, matrix);
            });
            vegetationRef.current.instanceMatrix.needsUpdate = true;
        }
    }, [decorationData]);
    
    if (!riverPath) return null;
    
    return (
        <group name="canyon-decorations">
            {/* Large boulders - irregular spheres */}
            {decorationData.boulders.length > 0 && (
                <instancedMesh
                    ref={bouldersRef}
                    args={[null, null, decorationData.boulders.length]}
                    castShadow
                    receiveShadow
                >
                    <dodecahedronGeometry args={[1, 1]} />
                    <meshStandardMaterial
                        color="#5a4a3a"
                        roughness={0.9}
                        metalness={0.1}
                    />
                </instancedMesh>
            )}
            
            {/* Small rocks on walls */}
            {decorationData.rocks.length > 0 && (
                <instancedMesh
                    ref={rocksRef}
                    args={[null, null, decorationData.rocks.length]}
                    castShadow
                    receiveShadow
                >
                    <dodecahedronGeometry args={[1, 1]} />
                    <meshStandardMaterial
                        color="#6b5a4a"
                        roughness={0.95}
                    />
                </instancedMesh>
            )}
            
            {/* Vegetation patches - small bushes */}
            {decorationData.vegetation.length > 0 && (
                <instancedMesh
                    ref={vegetationRef}
                    args={[null, null, decorationData.vegetation.length]}
                    castShadow
                    receiveShadow
                >
                    <sphereGeometry args={[1, 8, 6]} />
                    <meshStandardMaterial
                        color="#3a4a2a"
                        roughness={0.9}
                    />
                </instancedMesh>
            )}
        </group>
    );
}
