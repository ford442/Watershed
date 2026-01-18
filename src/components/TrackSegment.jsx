import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import FlowingWater from './FlowingWater';
import Rock from './Obstacles/Rock';
import Vegetation from './Environment/Vegetation';
import Grass from './Environment/Grass';
import Reeds from './Environment/Reeds';
import FloatingDebris from './Environment/FloatingDebris';
import Driftwood from './Environment/Driftwood';
import WaterfallParticles from './Environment/WaterfallParticles';
import FallingLeaves from './Environment/FallingLeaves';
import Fireflies from './Environment/Fireflies';
import Birds from './Environment/Birds';
import Fish from './Environment/Fish';

// Simple seeded random function
const seededRandom = (seed) => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
};

export default function TrackSegment({
    active = false,
    id: segmentId = -1,
    points: pathPoints,
    type = 'normal',
    biome = 'summer',
    width = 35,
    particleCount = 0,
    flowSpeed = 1.0,
    treeDensity = 1.0,
    rockDensity = 'low',
    rockMaterial,
    rockNormalMap
}) {
    // --- Hooks ---

    // Create the spline path (Only if active)
    const segmentPath = useMemo(() => {
        if (!active || !pathPoints || pathPoints.length === 0) return null;

        // Ponds use lower tension for smoother, wider curves. Waterfalls use standard.
        const tension = type === 'pond' ? 0.1 : 0.5;
        return new THREE.CatmullRomCurve3(pathPoints, false, 'catmullrom', tension);
    }, [active, pathPoints, type]);

    const pathLength = useMemo(() => {
        if (!segmentPath) return 0;
        return segmentPath.getLength();
    }, [segmentPath]);

    // --- Dynamic Dimensions based on Type ---
    const canyonWidth = width;
    const waterWidth  = type === 'pond' ? 45 : 10;
    const waterLevel  = 0.5;

    // Derived Placement Data (Rocks, Trees, etc.)
    const placementData = useMemo(() => {
        // Return empty data if inactive to save processing and avoid spawning assets
        if (!active || !segmentPath) {
            return { rocks: [], trees: [], debris: [], grass: [], reeds: [], driftwood: [], leaves: [], fireflies: [], birds: [], fish: [] };
        }

        const rocks = [];
        const trees = [];
        const debris = [];
        const grass = [];
        const reeds = [];
        const driftwood = [];
        const leaves = [];
        const fireflies = [];
        const birds = [];
        const fish = [];

        let seed = segmentId * 1000;
        const geoLength = pathLength;
        const zSteps = Math.ceil(pathLength / 2);

        const bankStart = waterWidth / 2;

        for(let z = 0; z < zSteps; z++) {
            const t = z / zSteps;
            const zLocal = (t - 0.5) * geoLength;
            
            const pathPoint = segmentPath.getPoint(t);
            const tangent = segmentPath.getTangent(t).normalize();
            const up = new THREE.Vector3(0, 1, 0);
            const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();

            const sides = [-1, 1];
            
            for (let sideIdx = 0; sideIdx < sides.length; sideIdx++) {
                const side = sides[sideIdx];
                const isPond = type === 'pond';

                // 1. ROCKS (Large)
                const rockChanceMultipliers = { low: 0.4, high: 0.7 };
                const rockChance = isPond ? 0.3 : rockChanceMultipliers[rockDensity] || 0.4;
                if (seededRandom(seed++) > (1.0 - rockChance)) {
                    const dist = bankStart + 1 + seededRandom(seed++) * 4;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;
                    
                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    
                    if (Math.abs(xLocal) < bankStart + 2) yHeight *= 0.1;

                    const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3;
                    yHeight += rockNoise * (0.5 + normalizedDist);

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight;

                    const scale = 0.8 + seededRandom(seed++) * 0.8;
                    const rotation = new THREE.Euler(
                        seededRandom(seed++)*Math.PI,
                        seededRandom(seed++)*Math.PI,
                        seededRandom(seed++)*Math.PI
                    );
                    rocks.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                }

                // 2. TREES
                const baseTreeChance = (biome === 'autumn' || isPond) ? 0.6 : 0.3;
                const treeChance = baseTreeChance * treeDensity;
                if (seededRandom(seed++) > (1.0 - treeChance)) {
                    const dist = bankStart + 4 + seededRandom(seed++) * 8;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;
                    
                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    yHeight += Math.sin(zLocal * 0.15) * Math.cos(xLocal * 0.3) * 1.5;

                    // Clamp tree height to prevent floating/sky trees
                    if (yHeight > 25) yHeight = 25 - seededRandom(seed++) * 2;

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight - 0.5;

                    const scale = 1.5 + seededRandom(seed++) * 1.0;
                    const rotation = new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0);
                    trees.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                }

                // 3. DEBRIS
                if (seededRandom(seed++) > 0.5) {
                    const dist = bankStart + seededRandom(seed++) * 2;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 0.5; 
                    debris.push({ position, rotation: new THREE.Euler(), scale: new THREE.Vector3(0.3,0.3,0.3) });
                }

                // 4. GRASS
                if (seededRandom(seed++) > 0.6) {
                    const dist = bankStart + seededRandom(seed++) * 4;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 1.0;
                    grass.push({ position, rotation: new THREE.Euler(0, Math.random(), 0), scale: new THREE.Vector3(0.5,0.5,0.5) });
                }

                // 5. REEDS
                if (seededRandom(seed++) > 0.5) {
                    const dist = bankStart + (seededRandom(seed++) - 0.2) * 1.5;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);

                    const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
                    let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    if (Math.abs(side * dist) < bankStart + 2) groundY *= 0.1;

                    position.y += groundY - 0.2;

                    const scale = 0.8 + seededRandom(seed++) * 0.4;
                    reeds.push({
                        position,
                        rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                        scale: new THREE.Vector3(scale, scale, scale)
                    });
                }

                // 6. DRIFTWOOD
                if (seededRandom(seed++) > 0.7) {
                    const dist = bankStart + (seededRandom(seed++) - 0.4) * 3.0;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);

                    const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
                    let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    if (Math.abs(side * dist) < bankStart + 2) groundY *= 0.1;

                    position.y += groundY + 0.3;

                    driftwood.push({
                        position,
                        rotation: new THREE.Euler(
                            (seededRandom(seed++) - 0.5) * 0.5,
                            seededRandom(seed++) * Math.PI * 2,
                            (seededRandom(seed++) - 0.5) * 0.5
                        ),
                        scale: new THREE.Vector3(1, 1, 1)
                    });
                }

                // 7. LEAVES
                const leafDensity = biome === 'autumn' ? 0.8 : 0.2;
                if (seededRandom(seed++) > (1.0 - leafDensity)) {
                    const dist = (seededRandom(seed++) - 0.5) * canyonWidth * 0.8;
                    const offset = binormal.clone().multiplyScalar(dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 15 + seededRandom(seed++) * 10;
                    leaves.push({
                        position,
                        rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                        scale: new THREE.Vector3(1, 1, 1)
                    });
                }

                // 8. FIREFLIES
                if (seededRandom(seed++) > 0.8) {
                    const dist = (seededRandom(seed++) - 0.5) * canyonWidth * 0.9;
                    const offset = binormal.clone().multiplyScalar(dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 1.0 + seededRandom(seed++) * 3.0;
                    fireflies.push({
                        position,
                        rotation: new THREE.Euler(),
                        scale: new THREE.Vector3(1, 1, 1)
                    });
                }

                // 9. BIRDS
                if (biome !== 'autumn' || isPond) {
                    if (seededRandom(seed++) > 0.98) {
                         const flockSize = 3 + Math.floor(seededRandom(seed++) * 5);
                         const dist = (seededRandom(seed++) - 0.5) * canyonWidth * 0.5;
                         const offset = binormal.clone().multiplyScalar(dist);
                         const flockCenter = new THREE.Vector3().copy(pathPoint).add(offset);

                         for(let b=0; b<flockSize; b++) {
                             const birdPos = flockCenter.clone();
                             birdPos.x += (seededRandom(seed++) - 0.5) * 5.0;
                             birdPos.z += (seededRandom(seed++) - 0.5) * 5.0;
                             birds.push({
                                 position: birdPos,
                                 rotation: new THREE.Euler(),
                                 scale: new THREE.Vector3(1,1,1)
                             });
                         }
                    }
                }

                // 10. FISH
                if (type === 'pond') {
                     if (seededRandom(seed++) > 0.6) {
                         const dist = (seededRandom(seed++) - 0.5) * waterWidth * 0.8;
                         const offset = binormal.clone().multiplyScalar(dist);
                         const position = new THREE.Vector3().copy(pathPoint).add(offset);
                         position.y += waterLevel - 0.5;
                         fish.push({
                             position,
                             rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                             scale: new THREE.Vector3(1, 1, 1)
                         });
                     }
                }
            }
        }
        
        return { rocks, trees, debris, grass, reeds, driftwood, leaves, fireflies, birds, fish };
    }, [segmentPath, pathLength, segmentId, canyonWidth, waterWidth, type, biome, rockDensity, treeDensity, active]);

    // Canyon Geometry
    const canyonGeometry = useMemo(() => {
        if (!active || !segmentPath) return null;

        const segmentsX = 40;
        const segmentsZ = Math.max(1, Math.floor(pathLength));

        const geo = new THREE.PlaneGeometry(canyonWidth, pathLength, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2);
        
        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();
        const colors = new Float32Array(positions.count * 3);
        const color = new THREE.Color();

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x; 
            const zLocal = vertex.z;
            const distFromCenter = Math.abs(xLocal);
            const normalizedDist = distFromCenter / (canyonWidth * 0.45);

            let yHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
            
            if (distFromCenter < waterWidth / 2) {
                yHeight *= 0.1; 
            }

            const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 + Math.sin(zLocal * 2.5 + xLocal * 1.2) * 0.1;
            yHeight += rockNoise * (0.5 + normalizedDist);
            
            const t = (zLocal + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));
            
            const dryness = Math.min(1.0, Math.max(0.0, (yHeight - 0.2) / 2.5));
            const intensity = 0.4 + 0.6 * dryness;
            color.setScalar(intensity);
            colors[i*3] = color.r; colors[i*3+1] = color.g; colors[i*3+2] = color.b;

            positions.setX(i, point.x + xLocal);
            positions.setY(i, point.y + yHeight);
            positions.setZ(i, point.z);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength, canyonWidth, waterWidth, active]);

    // Wall Shell Geometry
    const wallShellGeometry = useMemo(() => {
        if (!active || !segmentPath) return null;

        const shellWidth = canyonWidth * 1.5;
        const segmentsX = 20;
        const segmentsZ = Math.max(1, Math.floor(pathLength / 2));

        const geo = new THREE.PlaneGeometry(shellWidth, pathLength, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x;
            const zLocal = vertex.z;
            const distFromCenter = Math.abs(xLocal);
            
            let yHeight = 15 + (distFromCenter * 0.5); 
            yHeight += Math.sin(zLocal * 0.1) * 3 + Math.cos(xLocal * 0.2) * 2;

            const t = (zLocal + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));

            positions.setX(i, point.x + xLocal);
            positions.setY(i, point.y + yHeight - 2); 
            positions.setZ(i, point.z);
        }
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength, canyonWidth, active]);

    // Water Geometry
    const waterGeometry = useMemo(() => {
        if (!active || !segmentPath) return null;

        const segmentsZ = Math.max(1, Math.floor(pathLength / 2));
        const geo = new THREE.PlaneGeometry(waterWidth, pathLength, 4, segmentsZ);
        geo.rotateX(-Math.PI / 2);
        
        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const t = (z + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));
            positions.setX(i, point.x + x);
            positions.setY(i, point.y + waterLevel);
            positions.setZ(i, point.z);
        }
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength, waterWidth, active]);

    // Stream Data
    const streamData = useMemo(() => {
        if (!active || !segmentPath) return null;
        const startPoint = segmentPath.getPoint(0);
        const tangent = segmentPath.getTangent(0).normalize();
        return { start: startPoint, direction: tangent, length: pathLength };
    }, [segmentPath, pathLength, active]);

    // Waterfall position
    const waterfallPos = useMemo(() => {
        if (!active || type !== 'waterfall' || !segmentPath) return null;
        return segmentPath.getPoint(0.5);
    }, [type, segmentPath, active]);

    if (!active || !canyonGeometry || !waterGeometry || !rockMaterial) {
        return null;
    }

    return (
        <group name={`track-segment-${segmentId}`} visible={true}>
            <RigidBody key={`rb-${segmentId}`} type="fixed" colliders="trimesh" friction={1} restitution={0.1}>
                <mesh geometry={canyonGeometry} receiveShadow castShadow material={rockMaterial} />
            </RigidBody>

            <mesh geometry={wallShellGeometry} receiveShadow castShadow material={rockMaterial} />

            <Rock transforms={placementData.rocks} />
            <Vegetation transforms={placementData.trees} biome={biome} />
            <Grass transforms={placementData.grass} />
            <Reeds transforms={placementData.reeds} />
            <Driftwood transforms={placementData.driftwood} />
            <Rock transforms={placementData.debris} />

            <FallingLeaves transforms={placementData.leaves} biome={biome} />
            <Fireflies transforms={placementData.fireflies} />
            <Birds transforms={placementData.birds} biome={biome} />
            <Fish transforms={placementData.fish} />

            <FlowingWater 
                geometry={waterGeometry}
                flowSpeed={flowSpeed}
                baseColor={type === 'pond' ? "#1a4b6a" : "#1a6b8a"}
                normalMap={rockNormalMap}
            />
            
            {type === 'waterfall' && waterfallPos ? (
                <group position={waterfallPos}>
                    <WaterfallParticles count={particleCount} width={15} height={30} />
                </group>
            ) : (
                streamData && (
                    <FloatingDebris
                        streamStart={streamData.start}
                        streamDirection={streamData.direction}
                        streamLength={streamData.length}
                        waterLevel={waterLevel}
                        count={type === 'pond' ? 12 : 6}
                        seed={segmentId * 1000}
                    />
                )
            )}
        </group>
    );
}
