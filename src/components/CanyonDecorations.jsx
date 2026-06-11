import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';

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
 * @param {number} segmentSeed - Deterministic seed for layout stability
 * @param {number} wallTightness - Canyon tightness factor (0-1)
 * @param {number} waterLevel - Waterline Y used for foam generation
 * @param {number} rockDensityBias - Biome rock density multiplier
 * @param {(foam: Array) => void} onRockFoamUpdate - Callback with wake transforms
 */
const seededRandom = (seed) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
};

const isFiniteVec3 = (v) => v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z);

export default function CanyonDecorations({
    riverPath,
    trackWidth = 16,
    wallHeight = 12,
    segmentSeed = 1,
    wallTightness = 0.6,
    waterLevel = 0.5,
    rockDensityBias = 1.0,
    onRockFoamUpdate,
}) {
    // Generate deterministic decoration positions
    const decorationData = useMemo(() => {
        if (!riverPath) {
            return { largeBoulders: [], smallBoulders: [], wallRocks: [], vegetation: [], hangingGrowth: [], rockFoam: [] };
        }

        const boulders = [];
        const wallRocks = [];
        const vegetation = [];
        const hangingGrowth = [];
        const sampleCount = 17;
        let seed = Math.max(1, segmentSeed);

        const boulderChance = Math.min(0.58, Math.max(0.5, 0.45 + rockDensityBias * 0.07));

        const createBoulder = (side, point, right, tangent) => {
            if (seededRandom(seed++) > boulderChance) return null;

            const lateralMin = trackWidth * 0.24;
            const lateralMax = trackWidth * 0.45;
            const lateralOffset = lateralMin + seededRandom(seed++) * (lateralMax - lateralMin);
            const alongOffset = (seededRandom(seed++) - 0.5) * 4.5;
            const position = point.clone()
                .add(right.clone().multiplyScalar(side * lateralOffset))
                .add(tangent.clone().multiplyScalar(alongOffset));
            position.y += 0.1 + seededRandom(seed++) * 1.0;

            return {
                side,
                lateralOffset,
                tangent,
                right,
                centerPoint: point,
                alongOffset,
                position,
                scale: 1.2 + seededRandom(seed++) * 1.8, // 1.2 - 3.0
                rotation: [
                    seededRandom(seed++) * 0.9,
                    seededRandom(seed++) * Math.PI * 2,
                    seededRandom(seed++) * 0.8,
                ],
            };
        };

        const updateBoulderPosition = (boulder) => {
            boulder.position = boulder.centerPoint.clone()
                .add(boulder.right.clone().multiplyScalar(boulder.side * boulder.lateralOffset))
                .add(boulder.tangent.clone().multiplyScalar(boulder.alongOffset));
            boulder.position.y += 0.15;
        };

        for (let i = 0; i < sampleCount; i++) {
            const t = (i + 0.5) / sampleCount;
            const point = riverPath.getPoint(t);
            if (!isFiniteVec3(point)) continue;

            const tangent = riverPath.getTangent(t).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
            if (!isFiniteVec3(tangent) || !isFiniteVec3(right)) continue;

            const leftBoulder = createBoulder(-1, point, right, tangent);
            const rightBoulder = createBoulder(1, point, right, tangent);

            // Create deterministic choke-points by forcing mirrored pairs with narrow safe gaps.
            if (leftBoulder && rightBoulder) {
                const innerGap = trackWidth - leftBoulder.lateralOffset - rightBoulder.lateralOffset;
                if (innerGap < 10.0 && seededRandom(seed++) > 0.3) {
                    const leftRadius = leftBoulder.scale * 0.55;
                    const rightRadius = rightBoulder.scale * 0.55;
                    const desiredInnerGap = 6.0;
                    const centerGap = desiredInnerGap + leftRadius + rightRadius;
                    const mirroredOffset = Math.min(trackWidth * 0.42, Math.max(trackWidth * 0.2, centerGap * 0.5));

                    leftBoulder.lateralOffset = mirroredOffset;
                    rightBoulder.lateralOffset = mirroredOffset;
                    leftBoulder.alongOffset *= 0.5;
                    rightBoulder.alongOffset *= 0.5;

                    updateBoulderPosition(leftBoulder);
                    updateBoulderPosition(rightBoulder);
                }
            }

            if (leftBoulder && isFiniteVec3(leftBoulder.position)) boulders.push(leftBoulder);
            if (rightBoulder && isFiniteVec3(rightBoulder.position)) boulders.push(rightBoulder);

            for (let side = -1; side <= 1; side += 2) {
                const wallRockCount = 1 + Math.floor(seededRandom(seed++) * 2); // 1-2
                for (let j = 0; j < wallRockCount; j++) {
                    const wallOffset = (trackWidth * 0.5) + seededRandom(seed++) * 1.2;
                    const heightOnWall = seededRandom(seed++) * wallHeight * 0.85;
                    const position = point.clone()
                        .add(right.clone().multiplyScalar(side * wallOffset))
                        .add(tangent.clone().multiplyScalar((seededRandom(seed++) - 0.5) * 5.0));
                    position.y += heightOnWall;

                    if (!isFiniteVec3(position)) continue;
                    wallRocks.push({
                        position,
                        scale: 0.25 + seededRandom(seed++) * 0.45,
                        rotation: [
                            seededRandom(seed++) * Math.PI,
                            seededRandom(seed++) * Math.PI * 2,
                            seededRandom(seed++) * Math.PI,
                        ],
                    });
                }

                // Wall-clinging mid-height near-miss rocks pushed into channel by wall tightness.
                if (seededRandom(seed++) < 0.65) {
                    const channelPush = 0.35 + wallTightness * 1.4 + seededRandom(seed++) * 0.4;
                    const clingOffset = (trackWidth * 0.5) - channelPush;
                    const clingHeight = wallHeight * (0.3 + seededRandom(seed++) * 0.4);
                    const clingPos = point.clone()
                        .add(right.clone().multiplyScalar(side * clingOffset))
                        .add(tangent.clone().multiplyScalar((seededRandom(seed++) - 0.5) * 3.5));
                    clingPos.y += clingHeight;

                    if (isFiniteVec3(clingPos)) {
                        wallRocks.push({
                            position: clingPos,
                            scale: 0.45 + seededRandom(seed++) * 0.65,
                            rotation: [
                                seededRandom(seed++) * Math.PI * 0.6,
                                seededRandom(seed++) * Math.PI * 2,
                                seededRandom(seed++) * Math.PI * 0.6,
                            ],
                        });
                    }
                }

                // Sparse vegetation high on walls.
                if (seededRandom(seed++) > 0.72) {
                    const vegOffset = (trackWidth * 0.5) + 0.8 + seededRandom(seed++) * 1.2;
                    const position = point.clone()
                        .add(right.clone().multiplyScalar(side * vegOffset))
                        .add(tangent.clone().multiplyScalar((seededRandom(seed++) - 0.5) * 4.0));
                    position.y += wallHeight * (0.5 + seededRandom(seed++) * 0.35);

                    if (isFiniteVec3(position)) {
                        vegetation.push({
                            position,
                            scale: 0.35 + seededRandom(seed++) * 0.6,
                            rotation: seededRandom(seed++) * Math.PI * 2,
                        });
                    }
                }

                const waterlineBias = seededRandom(seed++);
                const hangingChance = side === -1 ? 0.62 : 0.48;
                if (waterlineBias < hangingChance) {
                    const wallOffset = (trackWidth * 0.5) + 0.45 + seededRandom(seed++) * 1.35;
                    const ledgeHeight = wallHeight * (0.18 + seededRandom(seed++) * 0.55);
                    const droopLength = 1.2 + seededRandom(seed++) * 2.4;
                    const position = point.clone()
                        .add(right.clone().multiplyScalar(side * wallOffset))
                        .add(tangent.clone().multiplyScalar((seededRandom(seed++) - 0.5) * 3.5));
                    position.y += ledgeHeight;

                    if (isFiniteVec3(position)) {
                        hangingGrowth.push({
                            position,
                            scale: new THREE.Vector3(
                                0.45 + seededRandom(seed++) * 0.35,
                                droopLength,
                                0.45 + seededRandom(seed++) * 0.25
                            ),
                            rotation: [
                                0.05 + seededRandom(seed++) * 0.12,
                                seededRandom(seed++) * Math.PI * 2,
                                side * (0.12 + seededRandom(seed++) * 0.18),
                            ],
                            color: seededRandom(seed++) > 0.45 ? '#4b5f32' : '#6b7d46',
                        });
                    }
                }
            }
        }

        const largeBoulders = boulders.filter((b) => b.scale > 1.5);
        const smallBoulders = boulders.filter((b) => b.scale <= 1.5);

        const rockFoam = largeBoulders
            .filter((b) => b.position.y <= (waterLevel + 0.45))
            .map((b) => ({
                position: new THREE.Vector3(b.position.x, waterLevel + 0.05, b.position.z),
                rotation: new THREE.Euler(-Math.PI / 2, Math.atan2(b.tangent.x, b.tangent.z), 0),
                scale: new THREE.Vector3(b.scale * 3.0, b.scale * 3.0, 1.0),
            }));

        return { largeBoulders, smallBoulders, wallRocks, vegetation, hangingGrowth, rockFoam };
    }, [riverPath, trackWidth, wallHeight, segmentSeed, wallTightness, waterLevel, rockDensityBias]);

    useEffect(() => {
        if (onRockFoamUpdate) {
            onRockFoamUpdate(decorationData.rockFoam);
        }
    }, [decorationData.rockFoam, onRockFoamUpdate]);
    
    // Refs for instanced meshes
    const smallBouldersRef = useRef();
    const wallRocksRef = useRef();
    const vegetationRef = useRef();
    const hangingGrowthRef = useRef();
    const boulderGeometry = useMemo(() => new THREE.DodecahedronGeometry(1, 1), []);
    const wallRockGeometry = useMemo(() => new THREE.DodecahedronGeometry(1, 1), []);
    const vegetationGeometry = useMemo(() => new THREE.SphereGeometry(1, 8, 6), []);
    const hangingGrowthGeometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(1, 1.8, 1, 4);
        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();
        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const yNorm = (vertex.y + 0.9) / 1.8;
            const taper = 1.0 - yNorm * 0.55;
            positions.setXYZ(i, vertex.x * taper, vertex.y - 0.9, vertex.z);
        }
        positions.needsUpdate = true;
        geo.computeVertexNormals();
        return geo;
    }, []);
    
    // Update instance matrices
    useEffect(() => {
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        // Update small visual-only boulders
        if (smallBouldersRef.current && decorationData.smallBoulders.length > 0) {
            decorationData.smallBoulders.forEach((boulder, i) => {
                if (!isFiniteVec3(boulder.position)) return;
                position.copy(boulder.position);
                quaternion.setFromEuler(new THREE.Euler(...boulder.rotation));
                scale.set(boulder.scale, boulder.scale * 0.8, boulder.scale);
                matrix.compose(position, quaternion, scale);
                smallBouldersRef.current.setMatrixAt(i, matrix);
            });
            smallBouldersRef.current.instanceMatrix.needsUpdate = true;
        }

        // Update wall rocks
        if (wallRocksRef.current && decorationData.wallRocks.length > 0) {
            decorationData.wallRocks.forEach((rock, i) => {
                if (!isFiniteVec3(rock.position)) return;
                position.copy(rock.position);
                quaternion.setFromEuler(new THREE.Euler(...rock.rotation));
                scale.set(rock.scale, rock.scale, rock.scale);
                matrix.compose(position, quaternion, scale);
                wallRocksRef.current.setMatrixAt(i, matrix);
            });
            wallRocksRef.current.instanceMatrix.needsUpdate = true;
        }

        // Update vegetation
        if (vegetationRef.current && decorationData.vegetation.length > 0) {
            decorationData.vegetation.forEach((veg, i) => {
                if (!isFiniteVec3(veg.position)) return;
                position.copy(veg.position);
                quaternion.setFromEuler(new THREE.Euler(0, veg.rotation, 0));
                scale.set(veg.scale, veg.scale * 0.6, veg.scale);
                matrix.compose(position, quaternion, scale);
                vegetationRef.current.setMatrixAt(i, matrix);
            });
            vegetationRef.current.instanceMatrix.needsUpdate = true;
        }

        if (hangingGrowthRef.current && decorationData.hangingGrowth.length > 0) {
            decorationData.hangingGrowth.forEach((growth, i) => {
                if (!isFiniteVec3(growth.position)) return;
                position.copy(growth.position);
                quaternion.setFromEuler(new THREE.Euler(...growth.rotation));
                scale.copy(growth.scale);
                matrix.compose(position, quaternion, scale);
                hangingGrowthRef.current.setMatrixAt(i, matrix);
                hangingGrowthRef.current.setColorAt(i, new THREE.Color(growth.color));
            });
            hangingGrowthRef.current.instanceMatrix.needsUpdate = true;
            if (hangingGrowthRef.current.instanceColor) {
                hangingGrowthRef.current.instanceColor.needsUpdate = true;
            }
        }
    }, [decorationData]);

    useFrame((state) => {
        if (!hangingGrowthRef.current) return;
        hangingGrowthRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.55 + segmentSeed * 0.01) * 0.045;
        hangingGrowthRef.current.rotation.x = Math.cos(state.clock.elapsedTime * 0.35 + segmentSeed * 0.015) * 0.018;
    });
    
    if (!riverPath) return null;
    
    return (
        <group name="canyon-decorations">
            {/* Large boulders with colliders for gameplay-critical obstacles */}
            {decorationData.largeBoulders.map((boulder, i) => (
                <RigidBody
                    key={`canyon-boulder-${segmentSeed}-${i}`}
                    type="fixed"
                    colliders="hull"
                    friction={1.1}
                    restitution={0.05}
                    position={[boulder.position.x, boulder.position.y, boulder.position.z]}
                    rotation={boulder.rotation}
                >
                    <mesh castShadow receiveShadow scale={[boulder.scale, boulder.scale * 0.8, boulder.scale]} geometry={boulderGeometry}>
                        <meshStandardMaterial color="#5a3f30" roughness={0.93} metalness={0.03} />
                    </mesh>
                </RigidBody>
            ))}

            {/* Small visual-only boulders keep density high at low physics cost */}
            {decorationData.smallBoulders.length > 0 && (
                <instancedMesh
                    ref={smallBouldersRef}
                    args={[boulderGeometry, null, decorationData.smallBoulders.length]}
                    castShadow
                    receiveShadow
                >
                    <meshStandardMaterial
                        color="#6a4b38"
                        roughness={0.92}
                        metalness={0.04}
                    />
                </instancedMesh>
            )}
            
            {/* Wall and wall-clinging rocks */}
            {decorationData.wallRocks.length > 0 && (
                <instancedMesh
                    ref={wallRocksRef}
                    args={[wallRockGeometry, null, decorationData.wallRocks.length]}
                    castShadow
                    receiveShadow
                >
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
                    args={[vegetationGeometry, null, decorationData.vegetation.length]}
                    castShadow
                    receiveShadow
                >
                    <meshStandardMaterial
                        color="#3a4a2a"
                        roughness={0.9}
                    />
                </instancedMesh>
            )}

            {decorationData.hangingGrowth.length > 0 && (
                <instancedMesh
                    ref={hangingGrowthRef}
                    args={[hangingGrowthGeometry, null, decorationData.hangingGrowth.length]}
                    castShadow
                    receiveShadow
                >
                    <meshStandardMaterial
                        color="#5a6b3d"
                        roughness={0.92}
                        metalness={0.0}
                        vertexColors
                        side={THREE.DoubleSide}
                    />
                </instancedMesh>
            )}
        </group>
    );
}
