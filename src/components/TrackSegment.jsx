import React, { useMemo, useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { useFrame, useThree } from '@react-three/fiber';
import FlowingWater from './FlowingWater';
import { extendRiverMaterial, updateRiverMaterial } from '../utils/RiverShader';
import { WATER_LEVEL, WALL_WATERLINE_Y, SHADERS, REACH_API_BASE } from '../constants/game';
import { AssetCache } from '../systems/ReachStreamer';
import { getTrackBiomeProfile } from '../configs/TrackBiomes';
import { SeededRandom } from '../systems/MapSystem';
import Vegetation from './Environment/Vegetation';
import Grass from './Environment/Grass';
import Foliage from './Environment/Foliage';
import Reeds from './Environment/Reeds';
import Driftwood from './Environment/Driftwood';
import FallingLeaves from './Environment/FallingLeaves';
import Fireflies from './Environment/Fireflies';
import Birds from './Environment/Birds';
import Fish from './Environment/Fish';
import Pebbles from './Environment/Pebbles';
import Mist from './Environment/Mist';
import WaterLilies from './Environment/WaterLilies';
import SunShafts from './Environment/SunShafts';
import Ferns from './Environment/Ferns';
import Rapids from './Environment/Rapids';
import Dragonflies from './Environment/Dragonflies';
import Pinecone from './Environment/Pinecone';
import Mushrooms from './Environment/Mushrooms';
import RockFoam from './Environment/RockFoam';
import Wildflowers from './Environment/Wildflowers';
import WaterfallParticles from './Environment/WaterfallParticles';
import FloatingObjectManager from './Environment/FloatingObjectManager';

// Simple seeded random function
const seededRandom = (seed) => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
};

/**
 * PondFog — Temporary dense fog when camera is inside a pond segment (Goal 3)
 */
function PondFog({ segmentCenter }) {
    const { camera, scene } = useThree();
    const originalFogRef = useRef(null);
    const isActiveRef = useRef(false);

    useEffect(() => {
        // Store original fog on mount
        originalFogRef.current = scene.fog ? {
            color: scene.fog.color.clone(),
            near: scene.fog.near,
            far: scene.fog.far,
        } : null;
        return () => {
            // Restore original fog on unmount
            if (originalFogRef.current && scene.fog) {
                scene.fog.color.set(originalFogRef.current.color);
                scene.fog.near = originalFogRef.current.near;
                scene.fog.far = originalFogRef.current.far;
            }
        };
    }, [scene]);

    useFrame(() => {
        if (!scene.fog) return;
        const dist = camera.position.distanceTo(segmentCenter);
        const shouldBeActive = dist < 40; // Fog radius

        if (shouldBeActive && !isActiveRef.current) {
            isActiveRef.current = true;
            // Dense pond fog: near=15, far=50 (Goal 3: fog 0.8 feel)
            scene.fog.color.set('#c8d8d0');
            scene.fog.near = 15;
            scene.fog.far = 50;
        } else if (!shouldBeActive && isActiveRef.current) {
            isActiveRef.current = false;
            // Restore original
            if (originalFogRef.current) {
                scene.fog.color.set(originalFogRef.current.color);
                scene.fog.near = originalFogRef.current.near;
                scene.fog.far = originalFogRef.current.far;
            }
        }
    });

    return null;
}

const hasFiniteCoordinates = (point) => (
    point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.z)
);

export default function TrackSegment({
    active = false,
    id: segmentId = -1,
    points: pathPoints,
    segmentPath: providedSegmentPath,
    type = 'normal',
    biome = 'summer',
    width = 35,
    waterWidth: waterWidthOverride,
    particleCount = 0,
    particleDensity = 1.0, // 0.0-1.0 for E4 scaling
    flowSpeed = 1.0,
    verticalBias = 0,
    treeDensity = 1.0,
    rockDensity = 'low',
    rockMaterial,
    rockNormalMap,
    segmentState = 'Normal',
    raftRef, // For tracking player velocity (E4)
    isNight = false,
    reachId,
    weatherWetnessRef,
    config,
}) {
    // console.log(`[TrackSegment ${segmentId}] Rendering - active: ${active}, has rockMaterial: ${!!rockMaterial}`);
    // --- Hooks ---

    // Create the spline path (Only if active)
    const biomeProfile = useMemo(() => getTrackBiomeProfile(biome), [biome]);

    const segmentPath = useMemo(() => {
        if (!active) return null;
        if (providedSegmentPath) return providedSegmentPath;
        if (!pathPoints || pathPoints.length < 2) return null;
        if (!pathPoints.every(hasFiniteCoordinates)) {
            const invalidIndexes = pathPoints
                .map((point, index) => (hasFiniteCoordinates(point) ? null : index))
                .filter((index) => index !== null);
            console.warn(`[TrackSegment ${segmentId}] Invalid path points supplied at indices: ${invalidIndexes.join(', ')}`);
            return null;
        }

        // Ponds use lower tension for smoother, wider curves. Waterfalls use standard.
        const tension = type === 'pond' ? 0.1 : 0.5;
        return new THREE.CatmullRomCurve3(pathPoints, false, 'catmullrom', tension);
    }, [active, pathPoints, providedSegmentPath, segmentId, type]);

    const pathLength = useMemo(() => {
        if (!segmentPath) return 0;
        try {
            const len = segmentPath.getLength();
            return Number.isFinite(len) && len > 0 ? len : 0;
        } catch (error) {
            console.warn(`[TrackSegment ${segmentId}] Failed to measure segment path`, error);
            return 0;
        }
    }, [segmentId, segmentPath]);

    // Resolve flowMap texture for this reach (if available)
    const flowMap = useMemo(() => {
        if (!reachId) return null;
        const manifest = AssetCache.reaches.get(reachId);
        const flowMapAsset = manifest?.requiredAssets?.flowMaps?.[0];
        if (!flowMapAsset) return null;
        const url = flowMapAsset.url.startsWith('http://') || flowMapAsset.url.startsWith('https://') || flowMapAsset.url.startsWith('/')
            ? flowMapAsset.url
            : `${REACH_API_BASE}/${reachId}/assets/${flowMapAsset.url}`;
        return AssetCache.flowMaps.get(url) || null;
    }, [reachId]);

    // --- Dynamic Dimensions based on Type ---
    const canyonWidth = biomeProfile.id === 'slotCanyon' ? biomeProfile.canyonWidth : width;
    const waterWidth = waterWidthOverride ?? (type === 'pond' ? Math.max(45, biomeProfile.waterWidth) : biomeProfile.waterWidth);
    const waterLevel = WATER_LEVEL;
    const isSlotCanyon = biomeProfile.id === 'slotCanyon';

    // Derived Placement Data - Trees and foliage enabled
    const placementData = useMemo(() => {
        if (!active || !segmentPath) {
            return {
                rocks: [],
                trees: [],
                debris: [],
                grass: [],
                wildflowers: [],
                reeds: [],
                driftwood: [],
                leaves: [],
                floatingLeaves: [],
                fireflies: [],
                birds: [],
                fish: [],
                pebbles: [],
                mist: [],
                waterLilies: [],
                sunShafts: [],
                ferns: [],
                rapids: [],
                dragonflies: [],
                pinecones: [],
                mushrooms: [],
                rockFoam: [],
            };
        }

        const rng = new SeededRandom(segmentId);

        /* DISABLED DECORATION LOGIC */
        const rocks = []; // Empty but defined to prevent reference errors
        const rockFoam = [];
        const trees = [];
        const debris = [];
        const grass = [];
        const wildflowers = [];
        const reeds = [];
        const driftwood = [];
        const leaves = [];
        const floatingLeaves = []; // New
        const fireflies = [];
        const birds = [];
        const fish = [];
        const pebbles = [];
        const mist = [];
        const waterLilies = [];
        const sunShafts = [];
        const ferns = [];
        const rapids = [];
        const dragonflies = [];
        const pinecones = [];
        const mushrooms = [];

        let seed = segmentId * 1000;
        const geoLength = pathLength;
        const zSteps = Math.ceil(pathLength / 2);

        const bankStart = waterWidth / 2;

        // --- Array-path: explicit authored decoration positions ---
        const treeDef = config?.decorations?.trees;
        const rockDef = config?.decorations?.rocks;

        if (Array.isArray(treeDef)) {
            treeDef.forEach(({ localX, localZ, scale: sc, rotation: rot }) => {
                const treeT = Math.max(0, Math.min(1, 0.5 + localZ / geoLength));
                const pp = segmentPath.getPoint(treeT);
                const tang = segmentPath.getTangent(treeT).normalize();
                const up = new THREE.Vector3(0, 1, 0);
                const bn = new THREE.Vector3().crossVectors(tang, up).normalize();
                const pos = pp.clone().add(bn.clone().multiplyScalar(localX));

                const normalizedDist = Math.abs(localX) / (canyonWidth * 0.45);
                let yH = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                yH += Math.sin(localZ * 0.15) * Math.cos(localX * 0.3) * 1.5;
                if (yH > 25) yH = 25;
                pos.y += yH - 0.5;

                const scaleMod = sc ?? 2.0;
                const rotEuler = new THREE.Euler(0, rot ?? 0, 0);
                trees.push({ position: pos, rotation: rotEuler, scale: new THREE.Vector3(scaleMod, scaleMod, scaleMod) });
            });
        }

        if (Array.isArray(rockDef)) {
            rockDef.forEach(({ localX, localZ, scale: sc, rotation: rot }) => {
                const rockT = Math.max(0, Math.min(1, 0.5 + localZ / geoLength));
                const pp = segmentPath.getPoint(rockT);
                const tang = segmentPath.getTangent(rockT).normalize();
                const up = new THREE.Vector3(0, 1, 0);
                const bn = new THREE.Vector3().crossVectors(tang, up).normalize();
                const pos = pp.clone().add(bn.clone().multiplyScalar(localX));

                const normalizedDist = Math.abs(localX) / (canyonWidth * 0.45);
                let yH = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                if (Math.abs(localX) < bankStart + 2) yH *= 0.1;
                pos.y += yH;

                const scaleMod = sc ?? 1.0;
                const rotEuler = rot != null
                    ? new THREE.Euler(0, rot, 0)
                    : new THREE.Euler(rng.next() * Math.PI, rng.next() * Math.PI, rng.next() * Math.PI);
                rocks.push({ position: pos, rotation: rotEuler, scale: new THREE.Vector3(scaleMod, scaleMod, scaleMod) });
            });
        }
        // ---------------------------------------------------------

        for (let z = 0; z < zSteps; z++) {
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

                // 1. ROCKS (Large) — skip if explicit authored positions provided
                if (!Array.isArray(rockDef)) {
                const rockChanceMultipliers = { low: 0.4, high: 0.7 };
                const rockChance = isPond ? 0.3 : (isSlotCanyon ? 0.8 : rockChanceMultipliers[rockDensity] || 0.4);
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
                        seededRandom(seed++) * Math.PI,
                        seededRandom(seed++) * Math.PI,
                        seededRandom(seed++) * Math.PI
                    );
                    rocks.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });

                    // 1.1 ROCK FOAM (Wake effect)
                    if (Math.abs(xLocal) < (waterWidth / 2) - 1.0) {
                        const foamRot = new THREE.Euler(-Math.PI / 2, Math.atan2(tangent.x, tangent.z), 0);
                        const foamScale = scale * 3.0;
                        const foamPos = position.clone();
                        foamPos.y = pathPoint.y + waterLevel + 0.05;

                        rockFoam.push({
                            position: foamPos,
                            rotation: foamRot,
                            scale: new THREE.Vector3(foamScale, foamScale, 1.0)
                        });
                    }
                }
                } // end if (!Array.isArray(rockDef))

                // 2. TREES (skip if explicit authored positions provided)
                if (!Array.isArray(treeDef)) {
                const baseTreeChance = isSlotCanyon ? 0.08 : ((biome === 'autumn' || isPond) ? 0.6 : 0.3);
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

                    // 2.1 PINECONES (Under trees)
                    // Scatter 2-5 pinecones around the tree base
                    const numPinecones = 2 + Math.floor(seededRandom(seed++) * 4);
                    for (let pc = 0; pc < numPinecones; pc++) {
                        const pcDist = 0.5 + seededRandom(seed++) * 1.5; // 0.5m to 2m radius
                        const pcAngle = seededRandom(seed++) * Math.PI * 2;

                        const pcPos = position.clone();
                        pcPos.x += Math.cos(pcAngle) * pcDist;
                        pcPos.z += Math.sin(pcAngle) * pcDist;

                        pcPos.y = position.y + 0.1; // Slightly above tree pivot

                        const pcScale = 0.15 + seededRandom(seed++) * 0.1; // Small!

                        pinecones.push({
                            position: pcPos,
                            rotation: new THREE.Euler(
                                seededRandom(seed++) * Math.PI, // Random tumble
                                seededRandom(seed++) * Math.PI,
                                seededRandom(seed++) * Math.PI
                            ),
                            scale: new THREE.Vector3(pcScale, pcScale, pcScale)
                        });
                    }
                }
                } // end if (!Array.isArray(treeDef))

                // 3. DEBRIS
                if (seededRandom(seed++) > 0.5) {
                    const dist = bankStart + seededRandom(seed++) * 2;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 0.5;
                    debris.push({ position, rotation: new THREE.Euler(), scale: new THREE.Vector3(0.3, 0.3, 0.3) });
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
                if (!isSlotCanyon && seededRandom(seed++) > 0.6) {
                    const dist = bankStart + seededRandom(seed++) * 4;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 1.0;
                    grass.push({ position, rotation: new THREE.Euler(0, rng.next(), 0), scale: new THREE.Vector3(0.5, 0.5, 0.5) });
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
                        rotation: new THREE.Euler(0, rng.next() * Math.PI, 0),
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

                    for (let f = 0; f < clusterSize; f++) {
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
                        groundY += Math.sin(zLocal * 0.8 + (side * dist) * 0.5) * 0.3;

                        position.y += groundY + 0.1;

                        const scale = 0.8 + seededRandom(seed++) * 0.6;
                        ferns.push({
                            position,
                            rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                            scale: new THREE.Vector3(scale, scale, scale)
                        });
                    }
                }

                // 4.7 MUSHROOMS (New: Forest floor detail)
                const mushroomChance = biome === 'autumn' ? 0.6 : 0.3;
                if (!isSlotCanyon && seededRandom(seed++) > (1.0 - mushroomChance)) {
                    // Cluster
                    const clusterSize = 3 + Math.floor(seededRandom(seed++) * 5);
                    // Placement: Near trees or damp spots (between bank and wall)
                    const baseDist = bankStart + 2 + seededRandom(seed++) * 5;

                    for (let m = 0; m < clusterSize; m++) {
                        const spreadX = (seededRandom(seed++) - 0.5) * 1.5;
                        const spreadZ = (seededRandom(seed++) - 0.5) * 1.5;

                        const dist = baseDist + spreadX;
                        const offset = binormal.clone().multiplyScalar(side * dist);
                        const zOffsetVec = tangent.clone().multiplyScalar(spreadZ);

                        const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zOffsetVec);

                        const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
                        let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                        if (Math.abs(side * dist) < bankStart + 2) groundY *= 0.1;
                        groundY += Math.sin(zLocal * 0.8 + (side * dist) * 0.5) * 0.3;

                        position.y += groundY; // Sit on ground

                        const scale = 0.8 + seededRandom(seed++) * 0.6;
                        mushrooms.push({
                            position,
                            rotation: new THREE.Euler(
                                (seededRandom(seed++) - 0.5) * 0.2,
                                seededRandom(seed++) * Math.PI * 2,
                                (seededRandom(seed++) - 0.5) * 0.2
                            ),
                            scale: new THREE.Vector3(scale, scale, scale)
                        });
                    }
                }

                // 5. REEDS
                if (!isSlotCanyon && seededRandom(seed++) > 0.5) {
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
                if (!isSlotCanyon && seededRandom(seed++) > 0.25) { // 75% chance per step (Significantly increased from 0.4)
                    // Chance for a larger pile (Log Jam)
                    const isPile = seededRandom(seed++) > 0.7;
                    const clusterSize = isPile ? 3 + Math.floor(seededRandom(seed++) * 4) : 1 + Math.floor(seededRandom(seed++) * 2);

                    // Center of the cluster for this step
                    const baseDist = bankStart + (seededRandom(seed++) - 0.1) * 3.0;

                    for (let d = 0; d < clusterSize; d++) {
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

                // 7. LEAVES (Falling - Enhanced)
                const baseLeafChance = biome === 'autumn' ? 0.8 : 0.2;
                if (seededRandom(seed++) > (1.0 - baseLeafChance)) {
                    // Determine count - More in autumn
                    const count = biome === 'autumn' ? 3 + Math.floor(seededRandom(seed++) * 5) : 1;

                    for (let l = 0; l < count; l++) {
                        const dist = (seededRandom(seed++) - 0.5) * canyonWidth * 0.9; // Wide spread
                        const offset = binormal.clone().multiplyScalar(dist);

                        // Add some random Z spread too
                        const zOffset = (seededRandom(seed++) - 0.5) * 5.0;
                        const zVec = tangent.clone().multiplyScalar(zOffset);

                        const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zVec);
                        position.y += 15 + seededRandom(seed++) * 10;

                        leaves.push({
                            position,
                            rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                            scale: new THREE.Vector3(1, 1, 1)
                        });
                    }
                }

                // 7.5 FLOATING LEAVES (Pond Only)
                // Static/Drifting leaves on the water surface
                if (type === 'pond') {
                    if (seededRandom(seed++) > 0.4) { // 60% chance per step
                        const count = 1 + Math.floor(seededRandom(seed++) * 3);
                        for (let fl = 0; fl < count; fl++) {
                            const dist = (seededRandom(seed++) - 0.5) * waterWidth * 0.9;
                            const offset = binormal.clone().multiplyScalar(dist);

                            // Spread Z
                            const zOffset = (seededRandom(seed++) - 0.5) * 4.0;
                            const zVec = tangent.clone().multiplyScalar(zOffset);

                            const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zVec);
                            position.y = waterLevel; // Exact water level

                            floatingLeaves.push({
                                position,
                                rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                                scale: new THREE.Vector3(1, 1, 1)
                            });
                        }
                    }
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
                if (!isSlotCanyon && (biome !== 'autumn' || isPond)) {
                    if (seededRandom(seed++) > 0.98) {
                        const flockSize = 3 + Math.floor(seededRandom(seed++) * 5);
                        const dist = (seededRandom(seed++) - 0.5) * canyonWidth * 0.5;
                        const offset = binormal.clone().multiplyScalar(dist);
                        const flockCenter = new THREE.Vector3().copy(pathPoint).add(offset);

                        for (let b = 0; b < flockSize; b++) {
                            const birdPos = flockCenter.clone();
                            birdPos.x += (seededRandom(seed++) - 0.5) * 5.0;
                            birdPos.z += (seededRandom(seed++) - 0.5) * 5.0;
                            birds.push({
                                position: birdPos,
                                rotation: new THREE.Euler(),
                                scale: new THREE.Vector3(1, 1, 1)
                            });
                        }
                    }
                }

                // 10. FISH
                if (!isSlotCanyon && type === 'pond') {
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
                    const mistChance = isSlotCanyon ? 0.35 : 0.6; // More mist in narrow canyons
                    if (seededRandom(seed++) > mistChance) {
                        const clusterSize = isSlotCanyon
                            ? 2 + Math.floor(seededRandom(seed++) * 3) // Denser mist in slot canyon
                            : 1 + Math.floor(seededRandom(seed++) * 2);
                        for (let m = 0; m < clusterSize; m++) {
                            const dist = (seededRandom(seed++) - 0.5) * waterWidth * 0.8;
                            const offset = binormal.clone().multiplyScalar(dist);
                            const position = new THREE.Vector3().copy(pathPoint).add(offset);

                            // Height: Slot canyons trap mist higher between walls
                            const mistHeight = isSlotCanyon
                                ? waterLevel + 0.3 + seededRandom(seed++) * 4.0
                                : waterLevel + 0.2 + seededRandom(seed++) * 2.0;
                            position.y = mistHeight;

                            mist.push({
                                position,
                                rotation: new THREE.Euler(),
                                scale: isSlotCanyon
                                    ? new THREE.Vector3(0.8, 1.5, 0.8) // Taller, compressed mist
                                    : new THREE.Vector3(1, 1, 1)
                            });
                        }
                    }
                }

                // 12. WATER LILIES (Pond Only)
                if (type === 'pond') {
                    if (seededRandom(seed++) > 0.85) { // Occasional clusters
                        const clusterSize = 3 + Math.floor(seededRandom(seed++) * 5);
                        const baseDist = (seededRandom(seed++) - 0.5) * waterWidth * 0.7; // Random spot on water

                        for (let l = 0; l < clusterSize; l++) {
                            const offsetSpread = 2.0;
                            const lx = baseDist + (seededRandom(seed++) - 0.5) * offsetSpread;
                            const lz = (seededRandom(seed++) - 0.5) * offsetSpread; // Local Z relative to cluster center

                            // Check bounds (roughly)
                            if (Math.abs(lx) > waterWidth / 2 - 2) continue; // Avoid bank clipping

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
                if (isSlotCanyon) {
                    // Slot canyon: dramatic narrow god rays from above
                    if (seededRandom(seed++) > 0.75) { // More frequent in narrows
                        const dist = (seededRandom(seed++) - 0.5) * waterWidth * 0.6;
                        const offset = binormal.clone().multiplyScalar(dist);
                        const position = new THREE.Vector3().copy(pathPoint).add(offset);

                        // Height: Start very high (tall canyon walls)
                        position.y = 20 + seededRandom(seed++) * 8;

                        // Rotation: Nearly vertical to simulate light from narrow opening
                        const lightDir = new THREE.Vector3(0.1, 1, 0.05).normalize();
                        const up = new THREE.Vector3(0, 1, 0);
                        const q = new THREE.Quaternion().setFromUnitVectors(up, lightDir);
                        const rotation = new THREE.Euler().setFromQuaternion(q);

                        // Narrow, tall beams for slot canyon
                        const scaleMod = 0.4 + seededRandom(seed++) * 0.3;

                        sunShafts.push({
                            position,
                            rotation,
                            scale: new THREE.Vector3(scaleMod * 0.5, scaleMod * 2.5, scaleMod * 0.5)
                        });
                    }
                } else if (biome !== 'autumn' || type === 'pond') { // More common in summer or open ponds
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

                // 14. RAPIDS (Whitewater)
                // Turbulent foam piles in fast water
                if (!isSlotCanyon && flowSpeed > 0.8 && type !== 'pond') {
                    // Density based on flow speed and rock density
                    const rapidChance = rockDensity === 'high' ? 0.6 : 0.3;

                    if (seededRandom(seed++) > (1.0 - rapidChance)) {
                        const clusterSize = 1 + Math.floor(seededRandom(seed++) * 3);
                        // Place in center channel (avoid banks)
                        const centerSpread = waterWidth * 0.4; // 40% of width

                        for (let r = 0; r < clusterSize; r++) {
                            const dist = (seededRandom(seed++) - 0.5) * centerSpread;
                            const offset = binormal.clone().multiplyScalar(dist);

                            // Spread Z slightly
                            const zOffsetVec = tangent.clone().multiplyScalar((seededRandom(seed++) - 0.5) * 2.0);

                            const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zOffsetVec);
                            position.y = waterLevel - 0.1; // Sits in water

                            const scale = 0.8 + seededRandom(seed++) * 0.8;

                            rapids.push({
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
                }

                // 15. DRAGONFLIES (Daytime activity near water)
                if (!isSlotCanyon && biome !== 'autumn' && type !== 'waterfall') {
                    if (seededRandom(seed++) > 0.7) { // 30% chance per step
                        const clusterSize = 1 + Math.floor(seededRandom(seed++) * 3);

                        // Place near banks
                        const dist = bankStart + (seededRandom(seed++) - 0.5) * 4.0;
                        const offset = binormal.clone().multiplyScalar(side * dist);
                        const position = new THREE.Vector3().copy(pathPoint).add(offset);

                        // Height: Hovering 1-3m above
                        position.y = waterLevel + 1.0 + seededRandom(seed++) * 2.0;

                        for (let d = 0; d < clusterSize; d++) {
                            // Slight spread
                            const dPos = position.clone();
                            dPos.x += (seededRandom(seed++) - 0.5) * 1.0;
                            dPos.z += (seededRandom(seed++) - 0.5) * 1.0;
                            dPos.y += (seededRandom(seed++) - 0.5) * 0.5;

                            dragonflies.push({
                                position: dPos,
                                rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                                scale: new THREE.Vector3(1, 1, 1)
                            });
                        }
                    }
                }
            }
        }

        return { rocks, trees, debris, grass, wildflowers, reeds, driftwood, leaves, floatingLeaves, fireflies, birds, fish, pebbles, mist, waterLilies, sunShafts, ferns, rapids, dragonflies, pinecones, mushrooms, rockFoam };
    }, [segmentId, pathLength, segmentPath, canyonWidth, waterWidth, waterLevel, biome, treeDensity, rockDensity, type, flowSpeed, config]);

    // Canyon Geometry
    const canyonGeometry = useMemo(() => {
        if (!active || !segmentPath) return null;

        // DEFENSIVE CHECK: Ensure valid path length
        const len = segmentPath.getLength();
        if (!len || len <= 0 || !isFinite(len)) {
            console.warn(`[TrackSegment ${segmentId}] Invalid pathLength: ${len}`);
            return null;
        }

        const segmentsX = 40;
        const segmentsZ = Math.max(2, Math.floor(len)); // At least 2 segments

        const geo = new THREE.PlaneGeometry(canyonWidth, len, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();
        const colors = new Float32Array(positions.count * 3);
        const color = new THREE.Color();

        // Biome-based color palette for the canyon floor (richer 5-stop gradient)
        // Tuned to bridge smoothly from water-edge to dry bank
        const dryColor = isSlotCanyon ? new THREE.Color(SHADERS.SLOT_ROCK_RIM) : (biome === 'autumn' ? new THREE.Color('#b89868') : new THREE.Color('#9a8e78'));
        const wetColor = isSlotCanyon ? new THREE.Color(SHADERS.SLOT_ROCK_SHADOW) : (biome === 'autumn' ? new THREE.Color('#4a3828') : new THREE.Color('#3e5038'));
        const shoreColor = isSlotCanyon ? new THREE.Color(SHADERS.SLOT_ROCK_BASE) : (biome === 'autumn' ? new THREE.Color('#685840') : new THREE.Color('#4a5c44'));
        const mossColor = isSlotCanyon ? new THREE.Color('#7c4a2d') : (biome === 'autumn' ? new THREE.Color('#7a6640') : new THREE.Color('#587248'));
        const bankColor = isSlotCanyon ? new THREE.Color('#bf7444') : (biome === 'autumn' ? new THREE.Color('#907850') : new THREE.Color('#788860'));

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x;
            const zLocal = vertex.z;
            const distFromCenter = Math.abs(xLocal);
            const normalizedDist = distFromCenter / (canyonWidth * 0.45);

            let yHeight = isSlotCanyon
                ? 22 + Math.pow(Math.max(0, normalizedDist), 1.8) * 18
                : Math.pow(Math.max(0, normalizedDist), 2.5) * 12;

            if (distFromCenter < waterWidth / 2) {
                yHeight *= isSlotCanyon ? 0.18 : 0.1;
            }

            const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 + Math.sin(zLocal * 2.5 + xLocal * 1.2) * 0.1;
            yHeight += rockNoise * (0.5 + normalizedDist);

            const t = (zLocal + len / 2) / len;
            const safeT = Math.max(0, Math.min(1, t));

            // GUARD: Check if getPoint returns valid result
            let point;
            try {
                point = segmentPath.getPoint(safeT);
                // Check for NaN
                if (!point || !isFinite(point.x) || !isFinite(point.y) || !isFinite(point.z)) {
                    console.warn(`[TrackSegment ${segmentId}] NaN in path point at t=${safeT}`);
                    point = new THREE.Vector3(0, 0, 0); // fallback
                }
            } catch (e) {
                console.warn(`[TrackSegment ${segmentId}] Error getting path point:`, e);
                point = new THREE.Vector3(0, 0, 0);
            }

            const dryness = Math.min(1.0, Math.max(0.0, (yHeight - 0.2) / 2.5));
            // 5-stop blend: wet → shore → moss → bank → dry for smoother waterline transition
            if (dryness < 0.20) {
                color.copy(wetColor).lerp(shoreColor, dryness / 0.20);
            } else if (dryness < 0.42) {
                color.copy(shoreColor).lerp(mossColor, (dryness - 0.20) / 0.22);
            } else if (dryness < 0.65) {
                color.copy(mossColor).lerp(bankColor, (dryness - 0.42) / 0.23);
            } else {
                color.copy(bankColor).lerp(dryColor, (dryness - 0.65) / 0.35);
            }
            // Subtle noise-based intensity variation for natural-looking surface.
            // Two frequency bands avoid obvious repetition; amplitude 0.10 keeps it gentle.
            const noiseVar = (Math.sin(zLocal * 1.3 + xLocal * 0.9) * 0.5 + 0.5) * 0.10
                + (Math.sin(zLocal * 3.1 + xLocal * 2.3) * 0.5 + 0.5) * 0.04;
            const intensity = 0.72 + 0.20 * dryness + noiseVar;
            color.multiplyScalar(intensity);
            colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;

            // GUARD: Check values before setting
            const finalX = point.x + xLocal;
            const finalY = point.y + yHeight;
            const finalZ = point.z;

            if (isFinite(finalX) && isFinite(finalY) && isFinite(finalZ)) {
                positions.setXYZ(i, finalX, finalY, finalZ);
            } else {
                positions.setXYZ(i, 0, 0, 0);
            }
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // GUARD: Don't compute normals if positions have NaN
        const posArray = positions.array;
        let hasNaN = false;
        for (let i = 0; i < posArray.length; i++) {
            if (!isFinite(posArray[i])) {
                hasNaN = true;
                posArray[i] = 0;
            }
        }
        if (!hasNaN) {
            geo.computeVertexNormals();
        }
        return geo;
    }, [segmentPath, pathLength, canyonWidth, waterWidth, active, segmentId, biome]);

    // Wall Shell Geometry
    const wallShellGeometry = useMemo(() => {
        if (!active || !segmentPath) return null;

        // DEFENSIVE CHECK: Ensure valid path length
        const len = segmentPath.getLength();
        if (!len || len <= 0 || !isFinite(len)) {
            console.warn(`[TrackSegment ${segmentId}] Invalid pathLength for wall: ${len}`);
            return null;
        }

        const shellWidth = isSlotCanyon ? canyonWidth * 0.92 : canyonWidth * 1.5;
        const segmentsX = 24;
        const segmentsZ = Math.max(2, Math.floor(len / 2));

        const geo = new THREE.PlaneGeometry(shellWidth, len, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();
        const colors = new Float32Array(positions.count * 3);
        const mossMask = new Float32Array(positions.count); // Moss/lichen mask channel

        // Color palette - three-stop gradient from waterline to rim
        const waterlineColor = new THREE.Color(0.08, 0.10, 0.07);
        const midWallColor = new THREE.Color(0.25, 0.22, 0.18);
        const rimColor = new THREE.Color(0.55, 0.48, 0.38);

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x;
            const zLocal = vertex.z;
            const distFromCenter = Math.abs(xLocal);

            let yHeight = isSlotCanyon
                ? biomeProfile.wallHeight + (distFromCenter * 0.18)
                : 15 + (distFromCenter * 0.5);
            yHeight += Math.sin(zLocal * 0.1) * (isSlotCanyon ? 1.8 : 3) + Math.cos(xLocal * 0.2) * (isSlotCanyon ? 1.1 : 2);

            // Height relative to water (water is at ~13 after -2 offset)
            const waterY = 13;
            const rimY = waterY + (isSlotCanyon ? 22 : 15);
            const heightAboveWater = Math.max(0, Math.min(1, (yHeight - 2 - waterY) / (rimY - waterY)));

            // Three-stop linear gradient from waterline to rim
            const c = new THREE.Color();
            if (heightAboveWater < 0.5) {
                c.copy(waterlineColor).lerp(midWallColor, heightAboveWater / 0.5);
            } else {
                c.copy(midWallColor).lerp(rimColor, (heightAboveWater - 0.5) / 0.5);
            }

            // Noise variation for natural look
            const noise1 = Math.sin(zLocal * 0.5 + xLocal * 0.3) * 0.5 + 0.5;
            const noise2 = Math.sin(zLocal * 1.2 + xLocal * 0.8) * 0.5 + 0.5;
            const detailNoise = noise1 * 0.08 + noise2 * 0.04;
            c.multiplyScalar(0.92 + detailNoise);

            // Organic band masks for shader-driven moss/lichen
            const bandNoise = Math.sin(zLocal * 0.3 + xLocal * 0.5) * 0.5 + 0.5;
            const bandNoise2 = Math.cos(zLocal * 0.7 - xLocal * 0.4) * 0.5 + 0.5;
            const mossBand = Math.max(0, 1.0 - Math.abs(heightAboveWater - 0.08) / 0.12) * bandNoise;
            const lichenBand = Math.max(0, 1.0 - Math.abs(heightAboveWater - 0.25) / 0.10) * bandNoise2;

            // Store moss mask for shader use (0-1 range)
            mossMask[i] = Math.max(mossBand, lichenBand * 0.7);

            colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;

            const t = (zLocal + len / 2) / len;
            const safeT = Math.max(0, Math.min(1, t));

            // GUARD: Check if getPoint returns valid result
            let point;
            try {
                point = segmentPath.getPoint(safeT);
                if (!point || !isFinite(point.x) || !isFinite(point.y) || !isFinite(point.z)) {
                    point = new THREE.Vector3(0, 0, 0);
                }
            } catch (e) {
                point = new THREE.Vector3(0, 0, 0);
            }

            // GUARD: Check values before setting
            const finalX = point.x + xLocal;
            const finalY = point.y + yHeight - 2;
            const finalZ = point.z;

            if (isFinite(finalX) && isFinite(finalY) && isFinite(finalZ)) {
                positions.setXYZ(i, finalX, finalY, finalZ);
            } else {
                positions.setXYZ(i, 0, 10, 0); // high fallback
            }
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setAttribute('mossMask', new THREE.BufferAttribute(mossMask, 1));

        // Compute triplanar UVs (secondary UV channel) to break up texture tiling
        const uv2 = new Float32Array(positions.count * 2);
        const worldPos = new THREE.Vector3();

        for (let i = 0; i < positions.count; i++) {
            worldPos.fromBufferAttribute(positions, i);

            // Triplanar UV projection using world-space XZ and XY
            // Scale factor to control texture density
            const scale = 0.08;
            const triplanarBlend = Math.abs(worldPos.y - 13) / 15; // Blend based on height

            // Primary triplanar: side projection (XZ plane with Y variation)
            const u1 = worldPos.x * scale;
            const v1 = worldPos.z * scale * 0.5; // Compress Z to reduce stretch

            // Secondary: top-down variation for rim areas
            const u2 = (worldPos.x + worldPos.z) * scale * 0.7;
            const v2 = worldPos.y * scale * 0.3;

            // Blend based on height above water
            const blend = Math.min(1, Math.max(0, triplanarBlend));
            uv2[i * 2] = u1 * (1 - blend) + u2 * blend;
            uv2[i * 2 + 1] = v1 * (1 - blend) + v2 * blend;
        }
        geo.setAttribute('uv2', new THREE.BufferAttribute(uv2, 2));

        // GUARD: Don't compute normals if positions have NaN
        const posArray = positions.array;
        let hasNaN = false;
        for (let i = 0; i < posArray.length; i++) {
            if (!isFinite(posArray[i])) {
                hasNaN = true;
                posArray[i] = 0;
            }
        }
        if (!hasNaN) {
            geo.computeVertexNormals();
        }
        return geo;
    }, [segmentPath, pathLength, canyonWidth, active, segmentId, biome]);

    // Water Geometry
    const waterGeometry = useMemo(() => {
        if (!active || !segmentPath) return null;

        // DEFENSIVE CHECK: Ensure valid path length
        const len = segmentPath.getLength();
        if (!len || len <= 0 || !isFinite(len)) {
            console.warn(`[TrackSegment ${segmentId}] Invalid pathLength for water: ${len}`);
            return null;
        }

        const segmentsZ = Math.max(2, Math.floor(len / 2));
        const geo = new THREE.PlaneGeometry(waterWidth, len, 4, segmentsZ);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const t = (z + len / 2) / len;
            const safeT = Math.max(0, Math.min(1, t));

            let point;
            try {
                point = segmentPath.getPoint(safeT);
                if (!point || !isFinite(point.x) || !isFinite(point.y) || !isFinite(point.z)) {
                    point = new THREE.Vector3(0, 0, 0);
                }
            } catch (e) {
                point = new THREE.Vector3(0, 0, 0);
            }

            const finalX = point.x + x;
            const finalY = point.y + waterLevel;
            const finalZ = point.z;

            if (isFinite(finalX) && isFinite(finalY) && isFinite(finalZ)) {
                positions.setXYZ(i, finalX, finalY, finalZ);
            } else {
                positions.setXYZ(i, 0, waterLevel, 0);
            }
        }

        // GUARD: Don't compute normals if positions have NaN
        const posArray = positions.array;
        let hasNaN = false;
        for (let i = 0; i < posArray.length; i++) {
            if (!isFinite(posArray[i])) {
                hasNaN = true;
                posArray[i] = 0;
            }
        }
        if (!hasNaN) {
            geo.computeVertexNormals();
        }
        return geo;
    }, [segmentPath, pathLength, waterWidth, active, segmentId]);

    // Waterfall position
    const waterfallPos = useMemo(() => {
        if (!active || type !== 'waterfall' || !segmentPath) return null;
        try {
            const point = segmentPath.getPoint(0.5);
            return hasFiniteCoordinates(point) ? point : null;
        } catch (error) {
            console.warn(`[TrackSegment ${segmentId}] Failed to compute waterfall position`, error);
            return null;
        }
    }, [type, segmentPath, active, segmentId]);

    if (!active || !canyonGeometry || !waterGeometry || !rockMaterial) {
        return null;
    }

    return (
        <TrackSegmentMeshes
            segmentId={segmentId}
            canyonGeometry={canyonGeometry}
            wallShellGeometry={wallShellGeometry}
            waterGeometry={waterGeometry}
            rockMaterial={rockMaterial}
            waterLevel={waterLevel}
            flowSpeed={flowSpeed}
            type={type}
            segmentState={segmentState}
            placementData={placementData}
            biome={biome}
            waterfallPos={waterfallPos}
            particleCount={particleCount}
            particleDensity={particleDensity}
            waterWidth={waterWidth}
            pathLength={pathLength}
            segmentPath={segmentPath}
            raftRef={raftRef}
            isNight={isNight}
            flowMap={flowMap}
            verticalBias={verticalBias}
            weatherWetnessRef={weatherWetnessRef}
        />
    );
}

// Inner component to handle material effects with hooks
function TrackSegmentMeshes({
    segmentId,
    canyonGeometry,
    wallShellGeometry,
    waterGeometry,
    rockMaterial,
    waterLevel,
    flowSpeed,
    type,
    segmentState,
    placementData,
    biome,
    waterfallPos,
    particleCount,
    particleDensity,
    waterWidth,
    pathLength,
    segmentPath,
    raftRef,
    isNight = false,
    flowMap,
    verticalBias = 0,
    weatherWetnessRef,
}) {
    const waterSurfaceOffset = (segmentState === 'downhill' || verticalBias <= -1.2) ? 0.6 : 0;
    const waterfallFanAngle = (type === 'waterfall' && (particleCount || 0) >= 500) ? 60 : 0;
    const biomeProfile = useMemo(() => getTrackBiomeProfile(biome), [biome]);
    // Clone material for wall to apply RiverShader effects
    const wallMaterialRef = useRef(null);

    // Track player velocity for particle scaling (E4)
    const [playerVelocity, setPlayerVelocity] = useState(0);

    // Vehicle position/velocity for FlowingWater
    const vehiclePos = useMemo(() => new THREE.Vector3(), []);
    const vehicleVelocity = useMemo(() => new THREE.Vector3(), []);

    // Pond draw distance culling (Goal 3)
    const vegetationGroupRef = useRef();
    const { camera, scene } = useThree();
    const segmentCenterRef = useRef(new THREE.Vector3());

    // Compute segment center from geometry for draw-distance culling
    useMemo(() => {
        if (canyonGeometry) {
            canyonGeometry.computeBoundingBox();
            canyonGeometry.boundingBox?.getCenter(segmentCenterRef.current);
        }
    }, [canyonGeometry]);

    // Update velocity each frame
    useFrame(() => {
        if (raftRef?.current) {
            const t = raftRef.current.translation();
            vehiclePos.set(t.x, t.y, t.z);
            const vel = raftRef.current.linvel?.();
            if (vel) {
                const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
                setPlayerVelocity(speed);
                vehicleVelocity.set(vel.x, vel.y, vel.z);
            }
        }

        // Goal 3: Pond draw distance — hide vegetation beyond 50m
        if (type === 'pond' && vegetationGroupRef.current) {
            const dist = camera.position.distanceTo(segmentCenterRef.current);
            vegetationGroupRef.current.visible = dist < 50;
        }
    });

    const wallMaterial = useMemo(() => {
        // Clone the rock material so we can apply shader effects
        const mat = rockMaterial.clone();
        mat.vertexColors = true;
        if (biomeProfile.id === 'slotCanyon') {
            mat.color.set(SHADERS.SLOT_ROCK_BASE);
            mat.roughness = 0.96;
            mat.metalness = 0;
        }
        // Apply RiverShader with moss and wetness
        extendRiverMaterial(mat, {
            enableWetness: true,
            enableMoss: true,
            enableTriplanar: true,
            waterLevel: WALL_WATERLINE_Y,
            wetnessRange: 4.0
        });
        return mat;
    }, [biomeProfile.id, rockMaterial]);

    wallMaterialRef.current = wallMaterial;

    // Update shader uniforms each frame
    useFrame((state) => {
        if (wallMaterialRef.current) {
            updateRiverMaterial(wallMaterialRef.current, state.clock.elapsedTime, {
                waterLevel: WALL_WATERLINE_Y,
                weatherWetness: weatherWetnessRef?.current || 0,
            });
        }
    });

    // Cleanup cloned material on unmount
    useMemo(() => {
        return () => {
            if (wallMaterialRef.current) {
                wallMaterialRef.current.dispose();
            }
        };
    }, []);

    return (
        <group name={`track-segment-${segmentId}`} visible={true}>
            <RigidBody key={`rb-${segmentId}`} type="fixed" colliders="trimesh" friction={segmentState === 'Flooded' ? 0.55 : segmentState === 'HighFlow' ? 0.8 : biomeProfile.wallFriction} restitution={biomeProfile.id === 'slotCanyon' ? 0.02 : 0.1}>
                <mesh geometry={canyonGeometry} material={rockMaterial} />
            </RigidBody>

            {/* Goal 3: Splash pool invisible catch collider */}
            {(type === 'splash' || type === 'pond') && (
                <RigidBody type="fixed" colliders={false}>
                    <CuboidCollider
                        args={[60, 0.5, 60]}
                        position={[segmentCenterRef.current.x, -8, segmentCenterRef.current.z]}
                        friction={0.9}
                        restitution={0.1}
                    />
                </RigidBody>
            )}

            {/* Goal 3: Pond fog override */}
            {type === 'pond' && <PondFog segmentCenter={segmentCenterRef.current} />}

            <mesh geometry={wallShellGeometry} material={wallMaterial} />

            <FlowingWater
                geometry={waterGeometry}
                flowSpeed={flowSpeed}
                biome={biome}
                isNight={isNight}
                baseColor={type === 'pond' ? "#1a4b6a" : undefined}
                flowMap={flowMap}
                vehiclePos={vehiclePos}
                vehicleVelocity={vehicleVelocity}
                waterSurfaceOffset={waterSurfaceOffset}
            />

            {/* Vegetation - Trees with Sway (ref for draw-distance culling) */}
            <group ref={vegetationGroupRef}>
                <Vegetation transforms={placementData.trees} biome={biome} />

            {/* Grass Bushes */}
            <Grass transforms={placementData.grass} />

            {/* Foliage Variety - Bushes, Grass Blades, Ground Plants */}
            <Foliage transforms={placementData.grass} biome={biome} density={1.2} />

            {/* Wildflowers - Pops of color on the banks */}
            <Wildflowers transforms={placementData.wildflowers} biome={biome} />

            {/* Ferns - Forest floor undergrowth */}
            <Ferns transforms={placementData.ferns} biome={biome} />

            {/* Mushrooms - Forest floor detail */}
            <Mushrooms transforms={placementData.mushrooms} biome={biome} />

            {/* Reeds - Shoreline cattails */}
            <Reeds transforms={placementData.reeds} />

            {/* Pebbles - Shoreline scatter */}
            <Pebbles transforms={placementData.pebbles} material={rockMaterial} />

            {/* Driftwood - Along river banks */}
            <Driftwood transforms={placementData.driftwood} />

            {/* Pinecones - Under trees */}
            <Pinecone transforms={placementData.pinecones} />

            {/* Falling Leaves */}
            <FallingLeaves transforms={placementData.leaves} biome={biome} />

            {/* Floating Leaves on water surface (ponds) */}
            <FallingLeaves transforms={placementData.floatingLeaves} biome={biome} floating={true} />

            {/* Water Lilies (ponds) */}
            <WaterLilies transforms={placementData.waterLilies} />

            {/* Mist - Atmospheric patches over water */}
            <Mist transforms={placementData.mist} />

            {/* Fireflies */}
            <Fireflies transforms={placementData.fireflies} />

            {/* Dragonflies */}
            <Dragonflies transforms={placementData.dragonflies} />

            {/* Birds */}
            <Birds transforms={placementData.birds} biome={biome} />

            {/* Fish (ponds/deep water) */}
            <Fish transforms={placementData.fish} />

            {/* Rapids - Whitewater foam */}
            <Rapids transforms={placementData.rapids} flowSpeed={flowSpeed} />

            {/* Rock Foam - Wake effects around rocks */}
            <RockFoam transforms={placementData.rockFoam} flowSpeed={flowSpeed} />

            {/* Sun Shafts - Atmospheric light rays */}
            <SunShafts transforms={placementData.sunShafts} />
            </group>

            {/* Goal 2: Dynamic floating objects (logs, tires, boats, debris) */}
            {segmentPath && (
                <FloatingObjectManager
                    path={segmentPath}
                    waterWidth={waterWidth}
                    flowSpeed={flowSpeed}
                    waterLevel={waterLevel}
                    count={Math.min(8, Math.floor(pathLength / 5))}
                    segmentId={segmentId}
                />
            )}

            {/* Waterfall Particles - with dynamic scaling (E4) */}
            {type === 'waterfall' && waterfallPos && (
                <group position={waterfallPos}>
                    <WaterfallParticles
                        count={particleCount || 300}
                        width={waterWidth}
                        height={20}
                        playerVelocity={playerVelocity}
                        particleDensity={particleDensity}
                        fanAngle={waterfallFanAngle}
                    />
                </group>
            )}
        </group>
    );
}
