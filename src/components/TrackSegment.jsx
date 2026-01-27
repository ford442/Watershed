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
import Wildflowers from './Environment/Wildflowers';
import WaterfallParticles from './Environment/WaterfallParticles';
import FallingLeaves from './Environment/FallingLeaves';
import Fireflies from './Environment/Fireflies';
import Birds from './Environment/Birds';
import Fish from './Environment/Fish';
import Pebbles from './Environment/Pebbles';
import Mist from './Environment/Mist';
import WaterLilies from './Environment/WaterLilies';
import SunShafts from './Environment/SunShafts';
import Ferns from './Environment/Ferns';

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
            return { rocks: [], trees: [], debris: [], grass: [], reeds: [], driftwood: [], leaves: [], fireflies: [], birds: [], fish: [], pebbles: [], sunShafts: [], ferns: [] };
        }

        const rocks = [];
        const trees = [];
        const debris = [];
        const grass = [];
        const wildflowers = [];
        const reeds = [];
        const driftwood = [];
        const leaves = [];
        const fireflies = [];
        const birds = [];
        const fish = [];
        const pebbles = [];
        const mist = [];
        const waterLilies = [];
        const sunShafts = [];
        const ferns = [];

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

                // 3.5 PEBBLES (New: Shoreline scatter)
                // High density, small objects along the water line
                if (seededRandom(seed++) > 0.3) { // 70% chance per step
                    // Spawn a cluster of 1-3 pebbles
                    const clusterSize = 1 + Math.floor(seededRandom(seed++) * 3);
                    for (let p = 0; p < clusterSize; p++) {
                         const dist = bankStart + seededRandom(seed++) * 1.5; // Very close to water
                         const offset = binormal.clone().multiplyScalar(side * dist);
                         const position = new THREE.Vector3().copy(pathPoint).add(offset);

                         // Determine height (shoreline slope)
                         const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
                         let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                         if (Math.abs(side * dist) < bankStart + 2) groundY *= 0.1;

                         position.y += groundY + 0.1; // Slightly embedded

                         // Randomize scale
                         const scale = 0.5 + seededRandom(seed++) * 0.6;
                         pebbles.push({
                            position,
                            rotation: new THREE.Euler(
                                seededRandom(seed++) * Math.PI,
                                seededRandom(seed++) * Math.PI,
                                seededRandom(seed++) * Math.PI
                            ),
                            scale: new THREE.Vector3(scale, scale, scale)
                         });
                    }
                }

                // 4. GRASS
                if (seededRandom(seed++) > 0.6) {
                    const dist = bankStart + seededRandom(seed++) * 4;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 1.0;
                    grass.push({ position, rotation: new THREE.Euler(0, Math.random(), 0), scale: new THREE.Vector3(0.5,0.5,0.5) });
                }

                // 4.5 WILDFLOWERS (New: Pops of Color)
                const flowerChance = biome === 'summer' ? 0.85 : 0.98; // Rare in autumn
                if (seededRandom(seed++) > flowerChance) {
                    const dist = bankStart + seededRandom(seed++) * 5;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 1.0; // Same ground level as grass approx

                    // Slightly smaller than grass bushes
                    const scale = 0.6 + seededRandom(seed++) * 0.4;
                    wildflowers.push({
                        position,
                        rotation: new THREE.Euler(0, Math.random() * Math.PI, 0),
                        scale: new THREE.Vector3(scale, scale, scale)
                    });
                }

                // 4.6 FERNS (New: Undergrowth clusters)
                // Ferns like the "floor" of the forest, often near trees or walls
                const fernChance = biome === 'autumn' ? 0.4 : 0.3; // More common in autumn (brown ferns) or summer (green)
                if (seededRandom(seed++) > (1.0 - fernChance)) {
                    // Spawn a cluster
                    const clusterSize = 3 + Math.floor(seededRandom(seed++) * 3);

                    // Placement: Between water edge and wall, leaning towards wall
                    const baseDist = bankStart + 3 + seededRandom(seed++) * 5;

                    for(let f=0; f<clusterSize; f++) {
                        const spreadX = (seededRandom(seed++) - 0.5) * 3.0;
                        const spreadZ = (seededRandom(seed++) - 0.5) * 3.0;

                        const dist = baseDist + spreadX;
                        const offset = binormal.clone().multiplyScalar(side * dist);
                        // Add Z spread via tangent
                        const zOffsetVec = tangent.clone().multiplyScalar(spreadZ);

                        const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zOffsetVec);

                        // Height Calc
                        const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
                        let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                        if (Math.abs(side * dist) < bankStart + 2) groundY *= 0.1;

                        // Noise variation for ground
                        groundY += Math.sin(zLocal * 0.8 + (side*dist) * 0.5) * 0.3;

                        position.y += groundY + 0.1;

                        const scale = 0.8 + seededRandom(seed++) * 0.6;
                        ferns.push({
                            position,
                            rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                            scale: new THREE.Vector3(scale, scale, scale)
                        });
                    }
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

                // 6. DRIFTWOOD (Enhanced Density)
                // Scatter new Driftwood instances along the river edge
                if (seededRandom(seed++) > 0.25) { // 75% chance per step (Significantly increased from 0.4)
                    // Chance for a larger pile (Log Jam)
                    const isPile = seededRandom(seed++) > 0.7;
                    const clusterSize = isPile ? 3 + Math.floor(seededRandom(seed++) * 4) : 1 + Math.floor(seededRandom(seed++) * 2);

                    // Center of the cluster for this step
                    const baseDist = bankStart + (seededRandom(seed++) - 0.1) * 3.0;

                    for(let d=0; d < clusterSize; d++) {
                        // Spread logic
                        const offsetZ = (seededRandom(seed++) - 0.5) * (isPile ? 3.0 : 1.5);
                        const offsetX = (seededRandom(seed++) - 0.5) * (isPile ? 2.5 : 1.0);

                        const dist = baseDist + offsetX;

                        // Calculate position: Start at path point, move along tangent (Z) and binormal (X)
                        const position = new THREE.Vector3().copy(pathPoint);
                        position.add(tangent.clone().multiplyScalar(offsetZ));
                        position.add(binormal.clone().multiplyScalar(side * dist));

                        // Height Calculation (Re-evaluate based on new dist)
                        const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
                        let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                        if (Math.abs(side * dist) < bankStart + 2) groundY *= 0.1;

                        position.y += groundY + 0.3; // Slight float

                        // Randomize scale for organic look
                        const scaleMod = 0.7 + seededRandom(seed++) * 0.8;

                        driftwood.push({
                            position,
                            rotation: new THREE.Euler(
                                (seededRandom(seed++) - 0.5) * 0.5,
                                seededRandom(seed++) * Math.PI * 2,
                                (seededRandom(seed++) - 0.5) * 0.5
                            ),
                            scale: new THREE.Vector3(scaleMod, scaleMod, scaleMod)
                        });
                    }
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

                // 11. MIST
                // Patches of mist floating above the water
                if (type !== 'waterfall') { // Waterfalls have their own particles
                    if (seededRandom(seed++) > 0.6) { // 40% chance per step to start a cluster
                        const clusterSize = 1 + Math.floor(seededRandom(seed++) * 2);
                        for(let m=0; m < clusterSize; m++) {
                            const dist = (seededRandom(seed++) - 0.5) * waterWidth * 0.8;
                            const offset = binormal.clone().multiplyScalar(dist);
                            const position = new THREE.Vector3().copy(pathPoint).add(offset);

                            // Height: Just above water (0.5) to 2.5
                            position.y = waterLevel + 0.2 + seededRandom(seed++) * 2.0;

                            mist.push({
                                position,
                                rotation: new THREE.Euler(),
                                scale: new THREE.Vector3(1, 1, 1)
                            });
                        }
                    }
                }

                // 12. WATER LILIES (Pond Only)
                if (type === 'pond') {
                    if (seededRandom(seed++) > 0.85) { // Occasional clusters
                        const clusterSize = 3 + Math.floor(seededRandom(seed++) * 5);
                        const baseDist = (seededRandom(seed++) - 0.5) * waterWidth * 0.7; // Random spot on water

                        for(let l=0; l<clusterSize; l++) {
                            const offsetSpread = 2.0;
                            const lx = baseDist + (seededRandom(seed++) - 0.5) * offsetSpread;
                            const lz = (seededRandom(seed++) - 0.5) * offsetSpread; // Local Z relative to cluster center

                            // Check bounds (roughly)
                            if (Math.abs(lx) > waterWidth/2 - 2) continue; // Avoid bank clipping

                            const offset = binormal.clone().multiplyScalar(lx);
                            const zOffsetVec = tangent.clone().multiplyScalar(lz);

                            const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zOffsetVec);
                            position.y = waterLevel; // Sit on water

                            const scale = 0.8 + seededRandom(seed++) * 0.4;
                            waterLilies.push({
                                position,
                                rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                                scale: new THREE.Vector3(scale, scale, scale)
                            });
                        }
                    }
                }

                // 13. SUN SHAFTS (Atmospheric)
                // Rare rays of light piercing the canopy
                if (biome !== 'autumn' || type === 'pond') { // More common in summer or open ponds
                    if (seededRandom(seed++) > 0.92) { // Occasional
                        const dist = (seededRandom(seed++) - 0.5) * canyonWidth * 0.6;
                        const offset = binormal.clone().multiplyScalar(dist);
                        const position = new THREE.Vector3().copy(pathPoint).add(offset);

                        // Height: Start high up
                        position.y = 12 + seededRandom(seed++) * 5;

                        // Rotation: Align with generic light direction (10, 20, 5)
                        const lightDir = new THREE.Vector3(10, 20, 5).normalize();
                        const up = new THREE.Vector3(0, 1, 0);
                        const q = new THREE.Quaternion().setFromUnitVectors(up, lightDir);
                        const rotation = new THREE.Euler().setFromQuaternion(q);

                        // Random scale for width/length variation
                        const scaleMod = 0.8 + seededRandom(seed++) * 0.4;

                        sunShafts.push({
                            position,
                            rotation,
                            scale: new THREE.Vector3(scaleMod, scaleMod * 1.5, scaleMod) // Make them longer
                        });
                    }
                }
            }
        }
        
        return { rocks, trees, debris, grass, wildflowers, reeds, driftwood, leaves, fireflies, birds, fish, pebbles, mist, waterLilies, sunShafts, ferns };
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
            <Wildflowers transforms={placementData.wildflowers} biome={biome} />
            <Ferns transforms={placementData.ferns} biome={biome} />
            <Reeds transforms={placementData.reeds} />
            <Driftwood transforms={placementData.driftwood} />
            <Rock transforms={placementData.debris} />
            {/* New Shoreline Pebbles */}
            <Pebbles transforms={placementData.pebbles} material={rockMaterial} />

            <FallingLeaves transforms={placementData.leaves} biome={biome} />
            <Fireflies transforms={placementData.fireflies} />
            <Birds transforms={placementData.birds} biome={biome} />
            <Fish transforms={placementData.fish} />
            <Mist transforms={placementData.mist} />
            <WaterLilies transforms={placementData.waterLilies} />
            <SunShafts transforms={placementData.sunShafts} />

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
