import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { useFrame, useThree } from '@react-three/fiber';
import FlowingWater from './FlowingWater';
import CanyonDecorations from './CanyonDecorations';
import { extendRiverMaterial, updateRiverMaterial } from '../utils/RiverShader';
import { createCanyonMaterial, updateCanyonMaterial } from '../materials/CanyonMaterial';
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
import Bats from './Environment/Bats';
import Fish from './Environment/Fish';
import Pebbles from './Environment/Pebbles';
import Mist from './Environment/Mist';
import WaterLilies from './Environment/WaterLilies';
import SunShafts from './Environment/SunShafts';
import Rainbow from './Environment/Rainbow';
import Ferns from './Environment/Ferns';
import Rapids from './Environment/Rapids';
import Dragonflies from './Environment/Dragonflies';
import Pinecone from './Environment/Pinecone';
import Mushrooms from './Environment/Mushrooms';
import RockFoam from './Environment/RockFoam';
import Wildflowers from './Environment/Wildflowers';
import WaterfallParticles from './Environment/WaterfallParticles';
import WaterfallSheet from './Environment/WaterfallSheet';
import WaterfallImpactZone from './Environment/WaterfallImpactZone';
import FloatingObjectManager from './Environment/FloatingObjectManager';
import CanyonDust from './Environment/CanyonDust';
import Cactus from './Environment/Cactus';
import DesertSage from './Environment/DesertSage';
import CanyonGrass from './Environment/CanyonGrass';
import CanyonBackground from './Environment/CanyonBackground';
import Rock from './Obstacles/Rock';
import IceSpray from './Environment/IceSpray';
import { useLOD } from '../systems/LODManager';
import { useBiome } from '../systems/BiomeSystem';
import { useSunPosition } from '../systems/SunPositionSystem';

// Simple seeded random function
const seededRandom = (seed) => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
};

const TREE_SPECIES = ['conifer', 'broadleaf', 'birch', 'snag'];
const FLOWER_VARIANTS = ['bloom', 'spike', 'daisy', 'bell'];
const ROCK_TYPES = ['boulder', 'slab', 'column'];

const pickTreeSpecies = ({ biomeProfile, biome, isRim, type, segmentId, instanceIndex }) => {
    const weights = biomeProfile.treeSpeciesWeights[isRim ? 'rim' : 'floor'];
    const speciesWeights = { ...weights };

    if (type === 'waterfall' || type === 'splash') {
        speciesWeights.snag += isRim ? 0.2 : 0.12;
        speciesWeights.broadleaf *= 0.75;
    }

    if (biome === 'summer' && !isRim) {
        speciesWeights.conifer += 0.08;
    }

    const total = TREE_SPECIES.reduce((sum, species) => sum + Math.max(0, speciesWeights[species] || 0), 0);
    if (total <= 0) {
        return { species: 'conifer', speciesIndex: 0 };
    }

    const roll = seededRandom(segmentId * 137 + instanceIndex * 97 + (isRim ? 53 : 11)) * total;
    let cursor = 0;
    for (let i = 0; i < TREE_SPECIES.length; i++) {
        const species = TREE_SPECIES[i];
        cursor += Math.max(0, speciesWeights[species] || 0);
        if (roll <= cursor) {
            return { species, speciesIndex: i };
        }
    }

    return { species: 'conifer', speciesIndex: 0 };
};

const createFlowerPayload = ({ position, rotation, scale, biome, segmentId, instanceIndex }) => {
    const variantIndex = Math.floor(seededRandom(segmentId * 137 + instanceIndex * 71 + 23) * FLOWER_VARIANTS.length);
    return {
        position,
        rotation,
        scale,
        variant: FLOWER_VARIANTS[variantIndex],
        variantIndex,
        colorIndex: Math.floor(seededRandom(segmentId * 137 + instanceIndex * 89 + 31) * 6),
        hueJitter: seededRandom(segmentId * 137 + instanceIndex * 113 + 7) - 0.5,
        lightnessJitter: seededRandom(segmentId * 137 + instanceIndex * 131 + (biome === 'autumn' ? 41 : 17)) - 0.5,
    };
};

const createRockPayload = ({ position, rotation, scale, biome, segmentId, instanceIndex, isScatter = false, nearWall = false }) => {
    let rockType = 'boulder';

    if (biome === 'slotCanyon') {
        const roll = seededRandom(segmentId * 137 + instanceIndex * 59 + (isScatter ? 17 : 7));
        rockType = roll > 0.68 ? 'column' : roll > 0.36 ? 'slab' : 'boulder';
    } else if (nearWall) {
        rockType = seededRandom(segmentId * 137 + instanceIndex * 47 + 13) > 0.58 ? 'slab' : 'boulder';
    }

    const shadePalette = biome === 'autumn'
        ? ['#8b7355', '#9f7b55', '#74563e']
        : biome === 'slotCanyon'
            ? ['#a65f3a', '#bf7444', '#8d4c2b']
            : ['#8f8576', '#9d8b78', '#6f675d'];

    const color = shadePalette[Math.floor(seededRandom(segmentId * 137 + instanceIndex * 83 + 29) * shadePalette.length)];
    const scaled = isScatter
        ? scale.clone().multiplyScalar(0.35 + seededRandom(segmentId * 137 + instanceIndex * 97 + 5) * 0.35)
        : scale;

    return {
        position,
        rotation,
        scale: scaled,
        rockType: ROCK_TYPES.includes(rockType) ? rockType : 'boulder',
        color,
    };
};

const lerpValue = (a, b, t) => a + (b - a) * t;

const smoothNoise = (seed) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
};

const SLOT_CANYON_STRATA = {
    bedrockColor: new THREE.Color('#5b2f1f'),
    sedimentaryColor: new THREE.Color('#8f4d2d'),
    graniteColor: new THREE.Color('#bf7444'),
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
    usePooledStaticObstacles = false,
}) {
    // console.log(`[TrackSegment ${segmentId}] Rendering - active: ${active}, has rockMaterial: ${!!rockMaterial}`);
    // --- Hooks ---

    // Create the spline path (Only if active)
    const biomeProfile = useMemo(() => getTrackBiomeProfile(biome), [biome]);
    const isGlacier = biomeProfile.id === 'glacier';
    const { quality: lodQuality } = useLOD();

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
    const channelProfile = useMemo(() => {
        if (!active || !segmentPath || pathLength <= 0) return [];

        const sampleCount = Math.max(8, Math.floor(pathLength / 2));
        const corridorHalfWidth = Math.max(3.2, Math.min(waterWidth * 0.35, waterWidth * 0.5 - 1.2));
        const widthAmplitude = type === 'pond' ? 0.06 : isSlotCanyon ? 0.12 : 0.18;
        const asymmetryAmplitude = isSlotCanyon ? 0.22 : 0.14;

        return Array.from({ length: sampleCount + 1 }, (_, index) => {
            const t = sampleCount === 0 ? 0 : index / sampleCount;
            const worldArc = segmentId + t;
            const baseWidth = waterWidth * 0.5;
            const widthNoise = smoothNoise(worldArc * 2.1 + 0.17) * 0.6 + smoothNoise(worldArc * 4.4 - 0.33) * 0.4;
            const riffleWave = Math.sin(worldArc * Math.PI * 1.35 + segmentId * 0.21);
            const riffleNoise = smoothNoise(worldArc * 3.2 + 1.7) * 0.35;
            const riffleStrength = THREE.MathUtils.clamp(riffleWave * 0.65 + riffleNoise, -1, 1);
            const poolDepth = THREE.MathUtils.clamp(Math.max(0, -riffleStrength), 0, 1);
            const riffleAmount = THREE.MathUtils.clamp(Math.max(0, riffleStrength), 0, 1);
            const widthScale = 1 + widthNoise * widthAmplitude + poolDepth * 0.16 - riffleAmount * 0.1;
            const asymmetry = smoothNoise(worldArc * 1.5 - 2.4) * asymmetryAmplitude;
            const leftHalfWidth = Math.max(corridorHalfWidth + 0.8, baseWidth * widthScale * (1 + asymmetry));
            const rightHalfWidth = Math.max(corridorHalfWidth + 0.8, baseWidth * widthScale * (1 - asymmetry));
            const floorDepth = poolDepth * (isSlotCanyon ? 1.4 : 1.1) - riffleAmount * 0.35;
            const floorWave = smoothNoise(worldArc * 6.4 + 0.8) * 0.18 + Math.sin(worldArc * Math.PI * 3.1) * 0.08;

            return {
                t,
                worldArc,
                leftHalfWidth,
                rightHalfWidth,
                corridorHalfWidth,
                floorDepth,
                floorWave,
                riffleStrength,
                gravelBarSide: asymmetry > 0 ? 1 : -1,
                undercutSide: asymmetry > 0 ? -1 : 1,
                flowScale: 1 + riffleAmount * 0.18 - poolDepth * 0.12,
            };
        });
    }, [active, segmentId, segmentPath, pathLength, waterWidth, type, isSlotCanyon]);

    // Derived Placement Data - Trees and foliage enabled
    const placementData = useMemo(() => {
        if (!active || !segmentPath) {
            return {
                rocks: [],
                scatterRocks: [],
                trees: [],
                cactus: [],
                desertSage: [],
                debris: [],
                grass: [],
                canyonGrass: [],
                wildflowers: [],
                reeds: [],
                driftwood: [],
                leaves: [],
                floatingLeaves: [],
                fireflies: [],
                birds: [],
                bats: [],
                fish: [],
                pebbles: [],
                sandBars: [],
                mist: [],
                waterLilies: [],
                sunShafts: [],
                ferns: [],
                rapids: [],
                dragonflies: [],
                pinecones: [],
                mushrooms: [],
                rimTrees: [],
                rockFoam: [],
                canyonDust: [],
            };
        }

        const rng = new SeededRandom(segmentId);

        /* DISABLED DECORATION LOGIC */
        const rocks = []; // Empty but defined to prevent reference errors
        const scatterRocks = [];
        const rockFoam = [];
        const trees = [];
        const cactus = [];
        const desertSage = [];
        const debris = [];
        const grass = [];
        const canyonGrass = [];
        const wildflowers = [];
        const reeds = [];
        const driftwood = [];
        const leaves = [];
        const floatingLeaves = []; // New
        const fireflies = [];
        const birds = [];
        const bats = [];
        const fish = [];
        const pebbles = [];
        const sandBars = [];
        const mist = [];
        const waterLilies = [];
        const sunShafts = [];
        const ferns = [];
        const rapids = [];
        const dragonflies = [];
        const pinecones = [];
        const mushrooms = [];
        const canyonDust = [];
        const rimTrees = [];

        let seed = segmentId * 1000;
        const geoLength = pathLength;
        const zSteps = Math.ceil(pathLength / 2);

        const bankStart = waterWidth / 2;
        const getChannelShape = (t) => {
            if (!channelProfile.length) {
                return {
                    leftHalfWidth: bankStart,
                    rightHalfWidth: bankStart,
                    corridorHalfWidth: Math.max(3.2, bankStart - 1.2),
                    floorDepth: 0,
                    floorWave: 0,
                    riffleStrength: 0,
                    gravelBarSide: 1,
                    undercutSide: -1,
                    flowScale: 1,
                };
            }

            const clampedT = THREE.MathUtils.clamp(t, 0, 1);
            const scaled = clampedT * (channelProfile.length - 1);
            const lower = Math.floor(scaled);
            const upper = Math.min(channelProfile.length - 1, lower + 1);
            const alpha = scaled - lower;
            const from = channelProfile[lower];
            const to = channelProfile[upper];

            return {
                leftHalfWidth: lerpValue(from.leftHalfWidth, to.leftHalfWidth, alpha),
                rightHalfWidth: lerpValue(from.rightHalfWidth, to.rightHalfWidth, alpha),
                corridorHalfWidth: lerpValue(from.corridorHalfWidth, to.corridorHalfWidth, alpha),
                floorDepth: lerpValue(from.floorDepth, to.floorDepth, alpha),
                floorWave: lerpValue(from.floorWave, to.floorWave, alpha),
                riffleStrength: lerpValue(from.riffleStrength, to.riffleStrength, alpha),
                gravelBarSide: alpha < 0.5 ? from.gravelBarSide : to.gravelBarSide,
                undercutSide: alpha < 0.5 ? from.undercutSide : to.undercutSide,
                flowScale: lerpValue(from.flowScale, to.flowScale, alpha),
            };
        };

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
                rocks.push(createRockPayload({
                    position: pos,
                    rotation: rotEuler,
                    scale: new THREE.Vector3(scaleMod, scaleMod, scaleMod),
                    biome,
                    segmentId,
                    instanceIndex: rocks.length,
                    nearWall: Math.abs(localX) > bankStart + 3,
                }));
            });
        }
        // ---------------------------------------------------------

        for (let z = 0; z < zSteps; z++) {
            const t = z / zSteps;
            const zLocal = (t - 0.5) * geoLength;
            const channelShape = getChannelShape(t);

            const pathPoint = segmentPath.getPoint(t);
            const tangent = segmentPath.getTangent(t).normalize();
            const up = new THREE.Vector3(0, 1, 0);
            const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();
            const tNext = Math.min(1.0, t + (1 / Math.max(1, zSteps)));
            const tangentNext = segmentPath.getTangent(tNext).normalize();
            const curvatureCross = new THREE.Vector3().crossVectors(tangent, tangentNext);
            const curvatureStrength = Math.abs(curvatureCross.y);
            const insideSide = curvatureCross.y > 0 ? -1 : 1;

            const sides = [-1, 1];

            for (let sideIdx = 0; sideIdx < sides.length; sideIdx++) {
                const side = sides[sideIdx];
                const isPond = type === 'pond';
                const bankEdge = side < 0 ? channelShape.leftHalfWidth : channelShape.rightHalfWidth;

                // 1. ROCKS (Large) — skip if explicit authored positions provided
                if (!Array.isArray(rockDef)) {
                const rockChanceMultipliers = { low: 0.4, high: 0.7 };
                const riffleBoost = Math.max(0, channelShape.riffleStrength) * 0.22;
                const rockChance = isPond ? 0.3 : (isSlotCanyon ? 0.8 : (rockChanceMultipliers[rockDensity] || 0.4) + riffleBoost);
                if (seededRandom(seed++) > (1.0 - rockChance)) {
                    const dist = bankEdge + 0.6 + seededRandom(seed++) * (2.6 + Math.max(0, channelShape.riffleStrength) * 1.5);
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
                    rocks.push(createRockPayload({
                        position,
                        rotation,
                        scale: new THREE.Vector3(scale, scale, scale),
                        biome,
                        segmentId,
                        instanceIndex: rocks.length,
                        nearWall: dist > bankStart + 3,
                    }));

                    const scatterCount = 2 + Math.floor(seededRandom(seed++) * 4);
                    for (let sr = 0; sr < scatterCount; sr++) {
                        const scatterPos = position.clone()
                            .add(tangent.clone().multiplyScalar((seededRandom(seed++) - 0.5) * 2.4))
                            .add(binormal.clone().multiplyScalar((seededRandom(seed++) - 0.5) * 2.2));
                        scatterPos.y = Math.max(waterLevel + 0.04, position.y - 0.2 + seededRandom(seed++) * 0.35);
                        scatterRocks.push(createRockPayload({
                            position: scatterPos,
                            rotation: new THREE.Euler(
                                seededRandom(seed++) * Math.PI,
                                seededRandom(seed++) * Math.PI * 2,
                                seededRandom(seed++) * Math.PI
                            ),
                            scale: new THREE.Vector3(1, 1, 1),
                            biome,
                            segmentId,
                            instanceIndex: scatterRocks.length,
                            isScatter: true,
                            nearWall: dist > bankStart + 3,
                        }));
                    }

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

                // 2. TREES / DESERT FLORA (skip if explicit authored tree positions provided)
                if (!Array.isArray(treeDef)) {
                    if (isSlotCanyon) {
                        const ledgeChance = 0.36;
                        if (seededRandom(seed++) > (1.0 - ledgeChance)) {
                            const dryLedgeDist = bankStart + (canyonWidth * 0.22) + seededRandom(seed++) * (canyonWidth * 0.16);
                            if (dryLedgeDist > waterWidth * 0.6) {
                                const offset = binormal.clone().multiplyScalar(side * dryLedgeDist);
                                const xLocal = side * dryLedgeDist;
                                const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                                let ledgeHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 10.5;
                                ledgeHeight += Math.sin(zLocal * 0.12 + xLocal * 0.18) * 0.8;

                                const position = new THREE.Vector3().copy(pathPoint).add(offset);
                                position.y += ledgeHeight + 0.25;
                                const rotation = new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0);

                                if (seededRandom(seed++) > 0.5) {
                                    const scale = 0.7 + seededRandom(seed++) * 0.6;
                                    cactus.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                                } else {
                                    const scale = 0.9 + seededRandom(seed++) * 0.7;
                                    desertSage.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                                }
                            }
                        }
                    } else {
                        const baseTreeChance = (biome === 'autumn' || isPond) ? 0.6 : 0.3;
                        const treeChance = baseTreeChance * treeDensity;
                        if (seededRandom(seed++) > (1.0 - treeChance)) {
                            const dist = bankStart + 4 + seededRandom(seed++) * 8;
                            const offset = binormal.clone().multiplyScalar(side * dist);
                            const xLocal = side * dist;

                            const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                            let yHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                            yHeight += Math.sin(zLocal * 0.15) * Math.cos(xLocal * 0.3) * 1.5;

                            if (yHeight > 25) yHeight = 25 - seededRandom(seed++) * 2;

                            const position = new THREE.Vector3().copy(pathPoint).add(offset);
                            position.y += yHeight - 0.5;

                            const scale = 1.5 + seededRandom(seed++) * 1.0;
                            const rotation = new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0);
                            const treeIndex = trees.length;
                            const treeSpecies = pickTreeSpecies({
                                biomeProfile,
                                biome,
                                isRim: false,
                                type,
                                segmentId,
                                instanceIndex: treeIndex,
                            });
                            trees.push({
                                position,
                                rotation,
                                scale: new THREE.Vector3(scale, scale, scale),
                                ...treeSpecies,
                            });

                            const numPinecones = 2 + Math.floor(seededRandom(seed++) * 4);
                            for (let pc = 0; pc < numPinecones; pc++) {
                                const pcDist = 0.5 + seededRandom(seed++) * 1.5;
                                const pcAngle = seededRandom(seed++) * Math.PI * 2;

                                const pcPos = position.clone();
                                pcPos.x += Math.cos(pcAngle) * pcDist;
                                pcPos.z += Math.sin(pcAngle) * pcDist;
                                pcPos.y = position.y + 0.1;

                                const pcScale = 0.15 + seededRandom(seed++) * 0.1;

                                pinecones.push({
                                    position: pcPos,
                                    rotation: new THREE.Euler(
                                        seededRandom(seed++) * Math.PI,
                                        seededRandom(seed++) * Math.PI,
                                        seededRandom(seed++) * Math.PI
                                    ),
                                    scale: new THREE.Vector3(pcScale, pcScale, pcScale)
                                });
                            }
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

                // 3.6 SAND BARS (Point bars on inside bends, summer only)
                if (
                    biome === 'summer' &&
                    !isSlotCanyon &&
                    side === insideSide &&
                    curvatureStrength > 0.008 &&
                    seededRandom(seed++) > 0.55
                ) {
                    const barWidth = 2.5 + seededRandom(seed++) * 3.0;
                    const barLength = barWidth * (0.55 + seededRandom(seed++) * 0.25);
                    const barOffset = bankStart * 0.58 + seededRandom(seed++) * (bankStart * 0.32);
                    const center = pathPoint.clone().add(binormal.clone().multiplyScalar(side * barOffset));
                    center.y = waterLevel + 0.08 + seededRandom(seed++) * 0.12;

                    sandBars.push({
                        center,
                        width: barWidth,
                        length: barLength,
                        tangent: tangent.clone(),
                        binormal: binormal.clone(),
                    });

                    // Pebble clusters on bars: denser than regular shoreline scatter.
                    const barPebbleCount = 3 + Math.floor(seededRandom(seed++) * 5);
                    for (let pb = 0; pb < barPebbleCount; pb++) {
                        const along = (seededRandom(seed++) - 0.5) * barLength * 1.7;
                        const across = (seededRandom(seed++) - 0.5) * barWidth * 0.9;
                        const pebblePos = center.clone()
                            .add(tangent.clone().multiplyScalar(along))
                            .add(binormal.clone().multiplyScalar(across));
                        pebblePos.y = center.y + 0.02;
                        const scale = 0.45 + seededRandom(seed++) * 0.55;
                        pebbles.push({
                            position: pebblePos,
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
                if (!isSlotCanyon && !isGlacier && seededRandom(seed++) > 0.6) {
                    const dist = bankStart + seededRandom(seed++) * 4;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 1.0;
                    grass.push({ position, rotation: new THREE.Euler(0, rng.next(), 0), scale: new THREE.Vector3(0.5, 0.5, 0.5) });
                }

                // 4.1 CANYON GRASS (slot canyon waterline)
                if (isSlotCanyon && seededRandom(seed++) > 0.48) {
                    const grassDist = bankStart + 0.6 + seededRandom(seed++) * Math.max(0.4, bankStart * 0.35);
                    const offset = binormal.clone().multiplyScalar(side * grassDist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);

                    const normalizedDist = Math.abs(side * grassDist) / (canyonWidth * 0.45);
                    let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    if (Math.abs(side * grassDist) < bankStart + 2) groundY *= 0.1;

                    position.y += Math.max(waterLevel + 0.05, groundY + 0.08);
                    const scale = 0.55 + seededRandom(seed++) * 0.45;
                    canyonGrass.push({
                        position,
                        rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                        scale: new THREE.Vector3(scale, scale, scale)
                    });
                }

                // 4.5 WILDFLOWERS - denser near waterline with deterministic clumping.
                if (!isSlotCanyon && !isGlacier) {
                    const bankHeight = Math.max(1.5, biomeProfile.wallHeight * 0.55);
                    const minFlowerDist = bankStart + 0.35;
                    const maxFlowerDist = bankStart + Math.min(7.5, canyonWidth * 0.18);
                    const dist = minFlowerDist + seededRandom(seed++) * Math.max(0.5, maxFlowerDist - minFlowerDist);
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;
                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    groundY += Math.sin(zLocal * 0.15) * Math.cos(xLocal * 0.3) * 1.5;
                    if (groundY > 25) groundY = 25 - seededRandom(seed++) * 2;

                    const heightAboveWaterline = Math.max(0, (groundY - 0.5) - waterLevel);
                    const waterlineFactor = Math.min(1, heightAboveWaterline / bankHeight);
                    const highNearWater = biome === 'autumn' ? 0.52 : 0.72;
                    const lowAtRim = biome === 'autumn' ? 0.14 : 0.2;
                    const wildflowerBoost = (type === 'normal' && particleCount > 0) ? Math.min(particleCount / 60, 2.5) : 1.0;
                    const spawnProbability = (highNearWater + (lowAtRim - highNearWater) * waterlineFactor) * wildflowerBoost;

                    if (seededRandom(seed++) < spawnProbability) {
                        const clusterSize = 2 + Math.floor(seededRandom(seed++) * 3);
                        const baseScale = biome === 'autumn' ? 0.55 + seededRandom(seed++) * 0.28 : 0.6 + seededRandom(seed++) * 0.35;

                        for (let wf = 0; wf < clusterSize; wf++) {
                            const spreadAlong = wf === 0 ? 0 : (seededRandom(seed++) - 0.5) * 1.2;
                            const spreadAcross = wf === 0 ? 0 : (seededRandom(seed++) - 0.5) * 0.9;
                            const position = new THREE.Vector3().copy(pathPoint)
                                .add(offset)
                                .add(tangent.clone().multiplyScalar(spreadAlong))
                                .add(binormal.clone().multiplyScalar(spreadAcross));
                            position.y = Math.max(waterLevel + 0.05, groundY + 0.12 + seededRandom(seed++) * 0.2);

                            const scaleMod = wf === 0 ? 1 : 0.78 + seededRandom(seed++) * 0.32;
                            const flowerIndex = wildflowers.length;
                            wildflowers.push(createFlowerPayload({
                                position,
                                rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                                scale: new THREE.Vector3(baseScale * scaleMod, baseScale * (0.9 + seededRandom(seed++) * 0.4), baseScale * scaleMod),
                                biome,
                                segmentId,
                                instanceIndex: flowerIndex,
                            }));
                        }
                    }
                }

                // 4.6 FERNS (New: Undergrowth clusters)
                // Ferns like the "floor" of the forest, often near trees or walls
                const fernChance = biome === 'autumn' ? 0.4 : 0.3;
                if (!isSlotCanyon && !isGlacier && seededRandom(seed++) > (1.0 - fernChance)) {
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
                if (!isSlotCanyon && !isGlacier && seededRandom(seed++) > (1.0 - mushroomChance)) {
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
                if (!isSlotCanyon && !isGlacier && seededRandom(seed++) > 0.5) {
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
                if (!isSlotCanyon && !isGlacier && seededRandom(seed++) > 0.25) { // 75% chance per step (Significantly increased from 0.4)
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
                if (side === 1 && birds.length < 8) {
                    const targetBirdCount = isSlotCanyon
                        ? 2 + Math.floor(seededRandom(seed++) * 3)
                        : 4 + Math.floor(seededRandom(seed++) * 5);
                    const spawnChance = isSlotCanyon ? 0.18 : 0.12;

                    if (seededRandom(seed++) < spawnChance) {
                        const birdPos = new THREE.Vector3().copy(pathPoint);

                        if (isSlotCanyon) {
                            const dist = (seededRandom(seed++) - 0.5) * canyonWidth * 0.45;
                            birdPos.add(binormal.clone().multiplyScalar(dist));
                            birdPos.add(tangent.clone().multiplyScalar((seededRandom(seed++) - 0.5) * 6.0));
                            birdPos.y += waterLevel + biomeProfile.wallHeight * 0.45 + seededRandom(seed++) * 4.0;
                        } else {
                            const sideSign = seededRandom(seed++) > 0.5 ? 1 : -1;
                            const dist = sideSign * (bankStart + 3 + seededRandom(seed++) * 5.0);
                            birdPos.add(binormal.clone().multiplyScalar(dist));
                            birdPos.add(tangent.clone().multiplyScalar((seededRandom(seed++) - 0.5) * 5.0));
                            birdPos.y += 5.5 + seededRandom(seed++) * 4.0;
                        }

                        if ((isSlotCanyon || biome === 'autumn') && bats.length < 12) {
                            const targetBatCount = 6 + Math.floor(seededRandom(seed++) * 7);
                            const spawnChance = isSlotCanyon ? 0.5 : 0.42;
                            if (seededRandom(seed++) < spawnChance) {
                                const wallSign = seededRandom(seed++) > 0.5 ? 1 : -1;
                                const creviceOffset = isSlotCanyon
                                    ? wallSign * (waterWidth * 0.48 + seededRandom(seed++) * 1.8)
                                    : wallSign * (bankStart + 4.5 + seededRandom(seed++) * 4.0);
                                const batPos = new THREE.Vector3().copy(pathPoint);
                                batPos.add(binormal.clone().multiplyScalar(creviceOffset));
                                batPos.add(tangent.clone().multiplyScalar((seededRandom(seed++) - 0.5) * 7.0));
                                batPos.y = waterLevel + 2 + seededRandom(seed++) * 2.0;

                                bats.push({
                                    position: batPos,
                                    rotation: new THREE.Euler(),
                                    scale: new THREE.Vector3(1, 1, 1),
                                });
                            }

                            if (bats.length > targetBatCount) {
                                bats.length = targetBatCount;
                            }
                        }

                        birds.push({
                            position: birdPos,
                            rotation: new THREE.Euler(),
                            scale: new THREE.Vector3(1, 1, 1)
                        });

                        if (!isSlotCanyon && birds.length < targetBirdCount && seededRandom(seed++) < 0.5) {
                            const buddyPos = birdPos.clone();
                            buddyPos.x += (seededRandom(seed++) - 0.5) * 2.5;
                            buddyPos.z += (seededRandom(seed++) - 0.5) * 2.5;
                            buddyPos.y += (seededRandom(seed++) - 0.5) * 1.2;
                            birds.push({
                                position: buddyPos,
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
                    if (isSlotCanyon) {
                        // Floor mist: dense, broad, near waterline.
                        const floorChance = lodQuality === 'low' ? 0.55 : 0.42;
                        if (seededRandom(seed++) > floorChance) {
                            const floorClusterSize = lodQuality === 'low'
                                ? 1 + Math.floor(seededRandom(seed++) * 2)
                                : 2 + Math.floor(seededRandom(seed++) * 4);
                            for (let m = 0; m < floorClusterSize; m++) {
                                const dist = (seededRandom(seed++) - 0.5) * waterWidth * 0.95;
                                const offset = binormal.clone().multiplyScalar(dist);
                                const position = new THREE.Vector3().copy(pathPoint).add(offset);
                                position.y = waterLevel + seededRandom(seed++) * 2.0;
                                const sx = 2.0 + seededRandom(seed++) * 2.0;
                                const sy = 1.2 + seededRandom(seed++) * 1.4;
                                const sz = 1.5 + seededRandom(seed++) * 1.5;
                                mist.push({
                                    position,
                                    rotation: new THREE.Euler(),
                                    scale: new THREE.Vector3(sx, sy, sz),
                                    type: 'floor',
                                });
                            }
                        }

                        // Column mist: isolated rising pillars toward the light shaft opening.
                        const allowColumnMist = lodQuality === 'high' || lodQuality === 'ultra';
                        if (allowColumnMist && seededRandom(seed++) > 0.6) {
                            const columnCount = 1 + Math.floor(seededRandom(seed++) * 2);
                            for (let c = 0; c < columnCount; c++) {
                                const dist = (seededRandom(seed++) - 0.5) * waterWidth * 0.5;
                                const offset = binormal.clone().multiplyScalar(dist);
                                const position = new THREE.Vector3().copy(pathPoint).add(offset);
                                position.y = waterLevel + 3.0 + seededRandom(seed++) * 7.0;
                                const sx = 0.5 + seededRandom(seed++) * 0.7;
                                const sy = 3.0 + seededRandom(seed++) * 4.0;
                                mist.push({
                                    position,
                                    rotation: new THREE.Euler(),
                                    scale: new THREE.Vector3(sx, sy, 0.4 + seededRandom(seed++) * 0.6),
                                    type: 'column',
                                });
                            }
                        }
                    } else {
                        const mistChance = 0.6;
                        if (seededRandom(seed++) > mistChance) {
                            const clusterSize = 1 + Math.floor(seededRandom(seed++) * 2);
                            for (let m = 0; m < clusterSize; m++) {
                                const dist = (seededRandom(seed++) - 0.5) * waterWidth * 0.8;
                                const offset = binormal.clone().multiplyScalar(dist);
                                const position = new THREE.Vector3().copy(pathPoint).add(offset);
                                position.y = waterLevel + 0.2 + seededRandom(seed++) * 2.0;
                                mist.push({
                                    position,
                                    rotation: new THREE.Euler(),
                                    scale: new THREE.Vector3(1, 1, 1),
                                    type: 'floor',
                                });
                            }
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
                    if (seededRandom(seed++) > 0.68) { // More frequent in narrows
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
                    const rapidChance = (rockDensity === 'high' ? 0.35 : 0.15) + Math.max(0, channelShape.riffleStrength) * 0.45;

                    if (seededRandom(seed++) > (1.0 - rapidChance)) {
                        const clusterSize = 1 + Math.floor(seededRandom(seed++) * 3);
                        // Place in center channel (avoid banks)
                        const centerSpread = channelShape.corridorHalfWidth * 1.4;

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

            // Slot canyon airborne dust: subtle additive motes near water and wall crevices.
            if (isSlotCanyon && (lodQuality === 'high' || lodQuality === 'ultra')) {
                if (seededRandom(seed++) > 0.25) {
                    const waterDist = (seededRandom(seed++) - 0.5) * waterWidth * 0.7;
                    const waterOffset = binormal.clone().multiplyScalar(waterDist);
                    const waterPos = new THREE.Vector3().copy(pathPoint).add(waterOffset);
                    waterPos.y = waterLevel + 0.15 + seededRandom(seed++) * 0.9;
                    canyonDust.push({
                        position: waterPos,
                        rotation: new THREE.Euler(),
                        scale: new THREE.Vector3(
                            0.15 + seededRandom(seed++) * 0.25,
                            0.22 + seededRandom(seed++) * 0.35,
                            0.15 + seededRandom(seed++) * 0.25
                        ),
                    });
                }

                if (seededRandom(seed++) > 0.35) {
                    const wallSide = seededRandom(seed++) > 0.5 ? 1 : -1;
                    const wallDist = bankStart + 0.5 + seededRandom(seed++) * Math.max(0.6, canyonWidth * 0.08);
                    const wallOffset = binormal.clone().multiplyScalar(wallSide * wallDist);
                    const wallPos = new THREE.Vector3().copy(pathPoint).add(wallOffset);
                    wallPos.y = waterLevel + 2.0 + seededRandom(seed++) * 6.0;
                    canyonDust.push({
                        position: wallPos,
                        rotation: new THREE.Euler(),
                        scale: new THREE.Vector3(
                            0.18 + seededRandom(seed++) * 0.22,
                            0.20 + seededRandom(seed++) * 0.30,
                            0.18 + seededRandom(seed++) * 0.22
                        ),
                    });
                }
            }
        }

        // Rim tree silhouettes: sparse, irregular placements along wall tops.
        const rimSides = [-1, 1];
        for (let sideIdx = 0; sideIdx < rimSides.length; sideIdx++) {
            const side = rimSides[sideIdx];
            const perSideCount = isSlotCanyon
                ? 3 + Math.floor(seededRandom(seed++) * 2) // 3-4
                : 3 + Math.floor(seededRandom(seed++) * 4); // 3-6

            for (let i = 0; i < perSideCount && rimTrees.length < 12; i++) {
                const baseT = (i + 0.5) / perSideCount;
                const t = Math.max(0.03, Math.min(0.97, baseT + (seededRandom(seed++) - 0.5) * 0.28));
                const zLocal = (t - 0.5) * geoLength;
                const pathPoint = segmentPath.getPoint(t);
                const tangent = segmentPath.getTangent(t).normalize();
                const up = new THREE.Vector3(0, 1, 0);
                const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();

                const rimOffset = isSlotCanyon
                    ? side * canyonWidth * 0.44
                    : side * canyonWidth * 0.72;

                // Mirrors wall-shell top height model so trees sit at the canyon rim.
                let wallTopY = isSlotCanyon
                    ? biomeProfile.wallHeight + (Math.abs(rimOffset) * 0.18)
                    : 15 + (Math.abs(rimOffset) * 0.5);
                wallTopY += Math.sin(zLocal * 0.1) * (isSlotCanyon ? 1.8 : 3)
                    + Math.cos(rimOffset * 0.2) * (isSlotCanyon ? 1.1 : 2);

                const position = new THREE.Vector3().copy(pathPoint).add(
                    binormal.clone().multiplyScalar(rimOffset)
                );
                position.y += wallTopY - 1.8 + seededRandom(seed++) * 1.3;

                const baseScale = isSlotCanyon
                    ? 0.85 + seededRandom(seed++) * 0.65
                    : 1.0 + seededRandom(seed++) * 1.1;
                const scale = isSlotCanyon
                    ? new THREE.Vector3(baseScale * 1.2, baseScale * 0.85, baseScale * 1.2)
                    : new THREE.Vector3(baseScale * 0.8, baseScale * 1.7, baseScale * 0.8);

                const rimTreeIndex = rimTrees.length;
                const treeSpecies = pickTreeSpecies({
                    biomeProfile,
                    biome,
                    isRim: true,
                    type,
                    segmentId,
                    instanceIndex: rimTreeIndex,
                });
                rimTrees.push({
                    position,
                    rotation: new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0),
                    scale,
                    ...treeSpecies,
                });
            }
        }

        if (isSlotCanyon || biome === 'autumn') {
            const minBats = 6;
            if (bats.length < minBats) {
                const maxBats = 12;
                const targetBatCount = minBats + Math.floor(seededRandom(seed++) * (maxBats - minBats + 1));
                const missing = targetBatCount - bats.length;
                for (let i = 0; i < missing; i++) {
                    const t = Math.max(0.02, Math.min(0.98, seededRandom(seed++)));
                    const pathPoint = segmentPath.getPoint(t);
                    const tangent = segmentPath.getTangent(t).normalize();
                    const up = new THREE.Vector3(0, 1, 0);
                    const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();
                    const wallSign = seededRandom(seed++) > 0.5 ? 1 : -1;
                    const creviceOffset = isSlotCanyon
                        ? wallSign * (waterWidth * 0.46 + seededRandom(seed++) * 2.1)
                        : wallSign * (bankStart + 4.0 + seededRandom(seed++) * 4.0);
                    const batPos = new THREE.Vector3().copy(pathPoint);
                    batPos.add(binormal.multiplyScalar(creviceOffset));
                    batPos.y = waterLevel + 2 + seededRandom(seed++) * 2.0;
                    bats.push({
                        position: batPos,
                        rotation: new THREE.Euler(),
                        scale: new THREE.Vector3(1, 1, 1),
                    });
                }
            }
        }

        return {
            rocks,
            scatterRocks,
            trees,
            cactus,
            desertSage,
            rimTrees,
            debris,
            grass,
            canyonGrass,
            wildflowers,
            reeds,
            driftwood,
            leaves,
            floatingLeaves,
            fireflies,
            birds,
            bats,
            fish,
            pebbles,
            sandBars,
            mist,
            waterLilies,
            sunShafts,
            ferns,
            rapids,
            dragonflies,
            pinecones,
            mushrooms,
            rockFoam,
            canyonDust
        };
    }, [segmentId, pathLength, segmentPath, canyonWidth, waterWidth, waterLevel, biome, treeDensity, rockDensity, type, flowSpeed, config, isSlotCanyon, isGlacier, lodQuality, biomeProfile.wallHeight, particleCount]);

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
        const dryColor   = isSlotCanyon ? new THREE.Color(SHADERS.SLOT_ROCK_RIM)
                         : isGlacier    ? new THREE.Color('#c8dce8')   // pale ice-scoured granite
                         : (biome === 'autumn' ? new THREE.Color('#b89868') : new THREE.Color('#9a8e78'));
        const wetColor   = isSlotCanyon ? new THREE.Color(SHADERS.SLOT_ROCK_SHADOW)
                         : isGlacier    ? new THREE.Color('#2a4858')   // deep glacial shadow
                         : (biome === 'autumn' ? new THREE.Color('#4a3828') : new THREE.Color('#3e5038'));
        const shoreColor = isSlotCanyon ? new THREE.Color(SHADERS.SLOT_ROCK_BASE)
                         : isGlacier    ? new THREE.Color('#6a9ab0')   // submerged blue-grey stone
                         : (biome === 'autumn' ? new THREE.Color('#685840') : new THREE.Color('#4a5c44'));
        const mossColor  = isSlotCanyon ? new THREE.Color('#7c4a2d')
                         : isGlacier    ? new THREE.Color('#4a7888')   // glacial algae / cryoconite
                         : (biome === 'autumn' ? new THREE.Color('#7a6640') : new THREE.Color('#587248'));
        const bankColor  = isSlotCanyon ? new THREE.Color('#bf7444')
                         : isGlacier    ? new THREE.Color('#a0b8c8')   // frost-dusted bank gravel
                         : (biome === 'autumn' ? new THREE.Color('#907850') : new THREE.Color('#788860'));
        const getChannelShape = (t) => {
            if (!channelProfile.length) {
                return {
                    leftHalfWidth: waterWidth * 0.5,
                    rightHalfWidth: waterWidth * 0.5,
                    corridorHalfWidth: Math.max(3.2, waterWidth * 0.5 - 1.2),
                    floorDepth: 0,
                    floorWave: 0,
                    riffleStrength: 0,
                    gravelBarSide: 1,
                    undercutSide: -1,
                };
            }
            const scaled = THREE.MathUtils.clamp(t, 0, 1) * (channelProfile.length - 1);
            const lower = Math.floor(scaled);
            const upper = Math.min(channelProfile.length - 1, lower + 1);
            const alpha = scaled - lower;
            const from = channelProfile[lower];
            const to = channelProfile[upper];
            return {
                leftHalfWidth: lerpValue(from.leftHalfWidth, to.leftHalfWidth, alpha),
                rightHalfWidth: lerpValue(from.rightHalfWidth, to.rightHalfWidth, alpha),
                corridorHalfWidth: lerpValue(from.corridorHalfWidth, to.corridorHalfWidth, alpha),
                floorDepth: lerpValue(from.floorDepth, to.floorDepth, alpha),
                floorWave: lerpValue(from.floorWave, to.floorWave, alpha),
                riffleStrength: lerpValue(from.riffleStrength, to.riffleStrength, alpha),
                gravelBarSide: alpha < 0.5 ? from.gravelBarSide : to.gravelBarSide,
                undercutSide: alpha < 0.5 ? from.undercutSide : to.undercutSide,
            };
        };

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x;
            const zLocal = vertex.z;
            const t = (zLocal + len / 2) / len;
            const safeT = Math.max(0, Math.min(1, t));
            const channelShape = getChannelShape(safeT);
            const signedBankWidth = xLocal < 0 ? channelShape.leftHalfWidth : channelShape.rightHalfWidth;
            const corridorWidth = Math.max(1.2, channelShape.corridorHalfWidth);
            const distFromCenter = Math.abs(xLocal);
            const normalizedDist = distFromCenter / (canyonWidth * 0.45);
            const bankRatio = distFromCenter / Math.max(0.001, signedBankWidth);
            const gravelBarInfluence = channelShape.gravelBarSide === Math.sign(xLocal || 1) ? 1 : 0;
            const undercutInfluence = channelShape.undercutSide === Math.sign(xLocal || 1) ? 1 : 0;

            let yHeight = isSlotCanyon
                ? 22 + Math.pow(Math.max(0, normalizedDist), 1.8) * 18
                : Math.pow(Math.max(0, normalizedDist), 2.5) * 12;

            if (distFromCenter < signedBankWidth) {
                const inChannel = distFromCenter / Math.max(0.001, signedBankWidth);
                const corridorEase = THREE.MathUtils.smoothstep(inChannel, 0, 1);
                yHeight *= isSlotCanyon ? 0.18 : 0.1;
                yHeight -= channelShape.floorDepth * 1.4;
                yHeight += channelShape.floorWave * (distFromCenter < corridorWidth ? 0.2 : 0.55);
                yHeight += Math.max(0, channelShape.riffleStrength) * inChannel * 0.35;
                yHeight += Math.max(0, 1 - corridorEase) * 0.05;
            } else {
                const aboveBank = Math.max(0, bankRatio - 1);
                yHeight += aboveBank * aboveBank * 4.5 * undercutInfluence;
                yHeight -= aboveBank * 1.25 * gravelBarInfluence;
            }

            const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 + Math.sin(zLocal * 2.5 + xLocal * 1.2) * 0.1;
            yHeight += rockNoise * (0.5 + normalizedDist);

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

            const depthTint = THREE.MathUtils.clamp(-channelShape.floorDepth * 0.25, 0, 0.2);
            const dryness = Math.min(1.0, Math.max(0.0, (yHeight - 0.2 + depthTint) / 2.5));
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
    }, [segmentPath, pathLength, canyonWidth, waterWidth, active, segmentId, biome, channelProfile, isSlotCanyon, isGlacier]);

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
        const highWaterMask = new Float32Array(positions.count); // Historical flood mark channel

        // Height bands relative to WALL_WATERLINE_Y.
        const bandPalette = isSlotCanyon
            ? {
                waterline: new THREE.Color('#2f1a12'),
                lower: new THREE.Color('#7e4123'),
                mid: new THREE.Color('#a95a32'),
                upper: new THREE.Color('#cc8353'),
                rim: new THREE.Color('#d2b08d'),
            }
            : isGlacier
            ? {
                // Ice-scoured granite: deep blue-black at waterline, frost-white at rim
                waterline: new THREE.Color('#1a2830'),
                lower: new THREE.Color('#3a5868'),
                mid: new THREE.Color('#607888'),
                upper: new THREE.Color('#8aaabb'),
                rim: new THREE.Color('#d0e8f0'),
            }
            : {
                waterline: new THREE.Color('#24170f'),
                lower: new THREE.Color('#5c3721'),
                mid: new THREE.Color('#87614b'),
                upper: new THREE.Color('#ae9173'),
                rim: new THREE.Color('#c8baa0'),
            };
        const rimGrey = new THREE.Color('#9a948b');

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x;
            const zLocal = vertex.z;
            const distFromCenter = Math.abs(xLocal);

            let yHeight = isSlotCanyon
                ? biomeProfile.wallHeight + (distFromCenter * 0.18)
                : 15 + (distFromCenter * 0.5);
            yHeight += Math.sin(zLocal * 0.1) * (isSlotCanyon ? 1.8 : 3) + Math.cos(xLocal * 0.2) * (isSlotCanyon ? 1.1 : 2);
            const strataWarp = Math.sin(zLocal * 0.14 + xLocal * 0.06 + segmentId * 0.17) * (isSlotCanyon ? 1.6 : 1.1)
                + Math.cos(zLocal * 0.22 - xLocal * 0.09) * (isSlotCanyon ? 0.8 : 0.55);

            // Height relative to waterline in wall-local coordinates.
            const localY = yHeight - 2;
            const relY = localY - WALL_WATERLINE_Y;
            const warpedRelY = relY + strataWarp;

            const c = new THREE.Color();
            if (warpedRelY < 0.5) {
                const blend = THREE.MathUtils.smoothstep(warpedRelY, -0.5, 0.5);
                c.copy(bandPalette.waterline).lerp(bandPalette.lower, blend);
            } else if (warpedRelY < 4.0) {
                const blend = THREE.MathUtils.smoothstep(warpedRelY, 0.5, 4.0);
                c.copy(bandPalette.lower).lerp(bandPalette.mid, blend);
            } else if (warpedRelY < 12.0) {
                const blend = THREE.MathUtils.smoothstep(warpedRelY, 4.0, 12.0);
                c.copy(bandPalette.mid).lerp(bandPalette.upper, blend * 0.25);
            } else if (warpedRelY < 18.0) {
                const blend = THREE.MathUtils.smoothstep(warpedRelY, 12.0, 18.0);
                c.copy(bandPalette.mid).lerp(bandPalette.upper, blend);
            } else if (warpedRelY < 26.0) {
                const blend = THREE.MathUtils.smoothstep(warpedRelY, 18.0, 26.0);
                const rimTint = bandPalette.rim.clone().lerp(rimGrey, 0.3 + blend * 0.25);
                c.copy(bandPalette.upper).lerp(rimTint, blend);
            } else {
                c.copy(bandPalette.rim).lerp(rimGrey, 0.55);
            }

            // Noise variation for natural look
            const noise1 = Math.sin(zLocal * 0.5 + xLocal * 0.3) * 0.5 + 0.5;
            const noise2 = Math.sin(zLocal * 1.2 + xLocal * 0.8) * 0.5 + 0.5;
            const seedNoise = Math.sin(zLocal * 0.77 + segmentId * 0.31) * 0.5 + 0.5;
            const detailNoise = noise1 * 0.08 + noise2 * 0.04 + seedNoise * 0.05;
            const verticalFade = THREE.MathUtils.clamp((warpedRelY + 2.0) / 24.0, 0, 1);
            c.multiplyScalar(0.78 + detailNoise + verticalFade * 0.18);

            // Organic band masks for shader-driven moss/lichen
            const bandNoise = Math.sin(zLocal * 0.3 + xLocal * 0.5) * 0.5 + 0.5;
            const bandNoise2 = Math.cos(zLocal * 0.7 - xLocal * 0.4) * 0.5 + 0.5;
            const normalizedWallHeight = isSlotCanyon ? 22 : 15;
            const heightAboveWater = Math.max(0, Math.min(1, relY / normalizedWallHeight));
            const mossBand = Math.max(0, 1.0 - Math.abs(heightAboveWater - 0.08) / 0.13) * bandNoise;
            const lichenBand = Math.max(0, 1.0 - Math.abs(heightAboveWater - 0.24) / 0.11) * bandNoise2;
            const floodMarkBand = Math.max(
                0,
                1.0 - Math.abs(heightAboveWater - 0.38) / 0.06
            ) * (0.7 + bandNoise * 0.3);

            // Store moss mask for shader use (0-1 range)
            mossMask[i] = Math.max(mossBand, lichenBand * 0.7);
            highWaterMask[i] = floodMarkBand;

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
        geo.setAttribute('highWaterMask', new THREE.BufferAttribute(highWaterMask, 1));

        // Compute triplanar UVs (secondary UV channel) to break up texture tiling
        const uv2 = new Float32Array(positions.count * 2);
        const worldPos = new THREE.Vector3();

        for (let i = 0; i < positions.count; i++) {
            worldPos.fromBufferAttribute(positions, i);

            // Triplanar UV projection using world-space XZ and XY
            // Scale factor to control texture density
            const scale = 0.07;
            const triplanarBlend = Math.abs(worldPos.y - WALL_WATERLINE_Y) / 12;

            // Primary triplanar: side projection (XZ plane with Y variation)
            const u1 = worldPos.x * scale;
            const v1 = worldPos.z * scale * 0.42;

            // Secondary: top-down variation for rim areas
            const u2 = (worldPos.x + worldPos.z) * scale * 0.65 + Math.sin(worldPos.y * 0.06) * 0.12;
            const v2 = worldPos.y * scale * 0.28 + Math.cos((worldPos.x - worldPos.z) * 0.04) * 0.08;

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
    }, [segmentPath, pathLength, canyonWidth, active, segmentId, biome, biomeProfile.wallHeight, isSlotCanyon, isGlacier]);

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
        const basePlaneWidth = waterWidth * 1.45;
        const geo = new THREE.PlaneGeometry(basePlaneWidth, len, 8, segmentsZ);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position;
        const getChannelShape = (t) => {
            if (!channelProfile.length) {
                return {
                    leftHalfWidth: waterWidth * 0.5,
                    rightHalfWidth: waterWidth * 0.5,
                    corridorHalfWidth: Math.max(3.2, waterWidth * 0.5 - 1.2),
                };
            }
            const scaled = THREE.MathUtils.clamp(t, 0, 1) * (channelProfile.length - 1);
            const lower = Math.floor(scaled);
            const upper = Math.min(channelProfile.length - 1, lower + 1);
            const alpha = scaled - lower;
            const from = channelProfile[lower];
            const to = channelProfile[upper];
            return {
                leftHalfWidth: lerpValue(from.leftHalfWidth, to.leftHalfWidth, alpha),
                rightHalfWidth: lerpValue(from.rightHalfWidth, to.rightHalfWidth, alpha),
                corridorHalfWidth: lerpValue(from.corridorHalfWidth, to.corridorHalfWidth, alpha),
            };
        };

        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const t = (z + len / 2) / len;
            const safeT = Math.max(0, Math.min(1, t));
            const channelShape = getChannelShape(safeT);
            const halfWidth = x < 0 ? channelShape.leftHalfWidth : channelShape.rightHalfWidth;
            const xNormalized = THREE.MathUtils.clamp(x / (basePlaneWidth * 0.5), -1, 1);
            const shapedX = xNormalized < 0
                ? xNormalized * channelShape.leftHalfWidth
                : xNormalized * channelShape.rightHalfWidth;

            let point;
            try {
                point = segmentPath.getPoint(safeT);
                if (!point || !isFinite(point.x) || !isFinite(point.y) || !isFinite(point.z)) {
                    point = new THREE.Vector3(0, 0, 0);
                }
            } catch (e) {
                point = new THREE.Vector3(0, 0, 0);
            }

            const finalX = point.x + shapedX;
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
    }, [segmentPath, pathLength, waterWidth, active, segmentId, channelProfile]);

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

    const plungeImpactPlacement = useMemo(() => {
        if (!active || !segmentPath) return null;

        try {
            if (type === 'waterfall' && waterfallPos) {
                return {
                    position: waterfallPos.clone().add(new THREE.Vector3(0, -10.0, 0)),
                    intensity: 1.0,
                    width: Math.max(6, waterWidth * 0.95),
                };
            }

            if (type === 'splash') {
                const point = segmentPath.getPoint(0.16);
                if (!hasFiniteCoordinates(point)) return null;
                point.y = waterLevel + 0.05;
                return {
                    position: point,
                    intensity: 0.72,
                    width: Math.max(7, waterWidth * 1.1),
                };
            }
        } catch (error) {
            console.warn(`[TrackSegment ${segmentId}] Failed to compute plunge impact placement`, error);
        }

        return null;
    }, [active, segmentId, segmentPath, type, waterfallPos, waterLevel, waterWidth]);

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
            plungeImpactPlacement={plungeImpactPlacement}
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
            isSlotCanyon={isSlotCanyon}
            active={active}
            usePooledStaticObstacles={usePooledStaticObstacles}
        />
    );
}

// Inner component to handle material effects with hooks
function TrackSegmentMeshes({
    segmentId,
    active,
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
    plungeImpactPlacement,
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
    isSlotCanyon = false,
    usePooledStaticObstacles = false,
}) {
    const { quality: lodQuality } = useLOD();
    const { timeOfDay } = useBiome();
    const { sunWorldPosition } = useSunPosition();
    const waterSurfaceOffset = (segmentState === 'downhill' || verticalBias <= -1.2) ? 0.6 : 0;
    const waterfallFanAngle = (type === 'waterfall' && (particleCount || 0) >= 500) ? 60 : 0;
    const biomeProfile = useMemo(() => getTrackBiomeProfile(biome), [biome]);
    const isGlacier = biomeProfile.id === 'glacier';
    const birdType = biomeProfile.id === 'slotCanyon' ? 'hawk' : 'songbird';
    const batsActive = (biomeProfile.id === 'slotCanyon' || biome === 'autumn' || biome === 'canyon') && timeOfDay > 0.65;
    const showCanyonBackground = biomeProfile.id === 'slotCanyon' || biome === 'canyon';
    // Clone material for wall to apply RiverShader effects
    const wallMaterialRef = useRef(null);

    // Track player velocity via ref for shader-driven effects without per-frame re-rendering.
    const playerVelocityRef = useRef(0);
    const [playerVelocityForParticles, setPlayerVelocityForParticles] = useState(0);
    const playerVelocitySyncAccumulator = useRef(0);
    const [canyonRockFoam, setCanyonRockFoam] = useState([]);

    // Vehicle position/velocity for FlowingWater
    const vehiclePos = useMemo(() => new THREE.Vector3(), []);
    const vehicleVelocity = useMemo(() => new THREE.Vector3(), []);

    // Pond draw distance culling (Goal 3)
    const vegetationGroupRef = useRef();
    const rimVegetationGroupRef = useRef();
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
    useFrame((_, delta) => {
        if (raftRef?.current) {
            const t = raftRef.current.translation();
            vehiclePos.set(t.x, t.y, t.z);
            const vel = raftRef.current.linvel?.();
            if (vel) {
                const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
                playerVelocityRef.current = speed;
                vehicleVelocity.set(vel.x, vel.y, vel.z);
            }
        }

        playerVelocitySyncAccumulator.current += delta;
        if (playerVelocitySyncAccumulator.current >= 0.12) {
            playerVelocitySyncAccumulator.current = 0;
            setPlayerVelocityForParticles(playerVelocityRef.current);
        }

        // Goal 3: Pond draw distance — hide vegetation beyond 50m
        if (type === 'pond' && vegetationGroupRef.current) {
            const dist = camera.position.distanceTo(segmentCenterRef.current);
            vegetationGroupRef.current.visible = dist < 50;
        }

        if (rimVegetationGroupRef.current) {
            const dist = camera.position.distanceTo(segmentCenterRef.current);
            const rimVisibilityDistance = lodQuality === 'low'
                ? 60
                : lodQuality === 'medium'
                    ? 90
                    : lodQuality === 'high'
                        ? 130
                        : 180;
            rimVegetationGroupRef.current.visible = dist < rimVisibilityDistance;
        }
    });

    const handleCanyonRockFoamUpdate = useCallback((foamTransforms) => {
        setCanyonRockFoam(Array.isArray(foamTransforms) ? foamTransforms : []);
    }, []);

    useEffect(() => {
        if (!isSlotCanyon) {
            setCanyonRockFoam([]);
        }
    }, [isSlotCanyon]);

    const mergedRockFoam = useMemo(
        () => (isSlotCanyon ? [...placementData.rockFoam, ...canyonRockFoam] : placementData.rockFoam),
        [canyonRockFoam, isSlotCanyon, placementData.rockFoam]
    );

    const highWaterMark = useMemo(() => {
        if (segmentState === 'Flooded') return 0.32;
        if (segmentState === 'HighFlow') return 0.24;
        return 0.15;
    }, [segmentState]);

    const highWaterIntensity = useMemo(() => {
        if (segmentState === 'Flooded') return 1.0;
        if (segmentState === 'HighFlow') return 0.7;
        return 0.35;
    }, [segmentState]);

    const allowColumnMist = lodQuality === 'high' || lodQuality === 'ultra';
    const allowCanyonDust = allowColumnMist;
    const rainbowOpacity = useMemo(() => {
        if (type !== 'splash' || isNight) return 0;
        const dayIn = THREE.MathUtils.smoothstep(timeOfDay, 0.15, 0.22);
        const dayOut = 1 - THREE.MathUtils.smoothstep(timeOfDay, 0.72, 0.8);
        const daytimeFactor = THREE.MathUtils.clamp(dayIn * dayOut, 0, 1);
        const mistFactor = THREE.MathUtils.smoothstep(particleDensity, 0.3, 0.6);
        return THREE.MathUtils.clamp(0.45 * daytimeFactor * mistFactor, 0, 0.45);
    }, [isNight, particleDensity, timeOfDay, type]);

    const rainbowPlacement = useMemo(() => {
        if (type !== 'splash' || !segmentPath) return null;
        try {
            const t = 0.25;
            const point = segmentPath.getPoint(t);
            const tangent = segmentPath.getTangent(t).normalize();
            if (!hasFiniteCoordinates(point)) return null;

            const lateral = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
            const toSun = new THREE.Vector3().copy(sunWorldPosition).sub(point);
            toSun.y = 0;
            if (toSun.lengthSq() > 0.0001) {
                toSun.normalize();
                if (lateral.dot(toSun) < 0) lateral.multiplyScalar(-1);
            }

            const yaw = Math.atan2(lateral.x, lateral.z);
            return {
                position: point.clone().add(new THREE.Vector3(0, 4.2, 0)),
                rotation: new THREE.Euler(Math.PI / 2, yaw, 0),
            };
        } catch (error) {
            console.warn(`[TrackSegment ${segmentId}] Failed to compute rainbow placement`, error);
            return null;
        }
    }, [segmentId, segmentPath, sunWorldPosition.x, sunWorldPosition.y, sunWorldPosition.z, type]);

    const sandBarGeometry = useMemo(() => {
        if (biome !== 'summer' || !Array.isArray(placementData.sandBars) || placementData.sandBars.length === 0) {
            return null;
        }

        const positions = [];
        const uvs = [];
        const indices = [];
        let baseIndex = 0;

        for (let i = 0; i < placementData.sandBars.length; i++) {
            const bar = placementData.sandBars[i];
            if (!bar?.center || !bar?.tangent || !bar?.binormal || !isFinite(bar.width) || !isFinite(bar.length)) continue;

            const center = bar.center;
            const tangent = bar.tangent;
            const binormal = bar.binormal;
            const halfW = bar.width * 0.5;
            const halfL = bar.length;

            const corners = [
                center.clone().addScaledVector(binormal, -halfW).addScaledVector(tangent, -halfL),
                center.clone().addScaledVector(binormal, halfW).addScaledVector(tangent, -halfL),
                center.clone().addScaledVector(binormal, halfW).addScaledVector(tangent, halfL),
                center.clone().addScaledVector(binormal, -halfW).addScaledVector(tangent, halfL),
            ];

            for (let c = 0; c < corners.length; c++) {
                const vertex = corners[c];
                positions.push(vertex.x, vertex.y, vertex.z);
            }

            uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
            indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
            baseIndex += 4;
        }

        if (positions.length === 0) return null;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
    }, [biome, placementData.sandBars]);

    useEffect(() => {
        return () => {
            sandBarGeometry?.dispose();
        };
    }, [sandBarGeometry]);

    const sandBarMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#d4b483',
        roughness: 1.0,
        metalness: 0.0,
    }), []);

    useEffect(() => {
        return () => {
            sandBarMaterial.dispose();
        };
    }, [sandBarMaterial]);

    const wallMaterial = useMemo(() => {
        if (isSlotCanyon) {
            return createCanyonMaterial({
                biome: 'slotCanyon',
                wallHeight: biomeProfile.wallHeight || 26,
                parallaxScale: 0.025,
                flowSpeed,
                mossCoverage: 1.0,
                highWaterMark: segmentState === 'Flooded' ? 0.35 : segmentState === 'HighFlow' ? 0.25 : 0.15,
                highWaterIntensity,
                strata: SLOT_CANYON_STRATA,
            });
        }

        // Clone the rock material so we can apply shader effects
        const mat = rockMaterial.clone();
        mat.vertexColors = true;
        // Apply RiverShader with moss and wetness
        extendRiverMaterial(mat, {
            enableWetness: true,
            enableMoss: true,
            enableTriplanar: true,
            waterLevel: WALL_WATERLINE_Y,
            wetnessRange: type === 'waterfall' || type === 'splash' ? 7.5 : 4.0
        });
        return mat;
    }, [biomeProfile.wallHeight, flowSpeed, highWaterIntensity, highWaterMark, isSlotCanyon, rockMaterial, type, segmentState]);

    wallMaterialRef.current = wallMaterial;

    // Update shader uniforms each frame
    useFrame((state) => {
        if (isSlotCanyon && wallMaterialRef.current?.uniforms) {
            updateCanyonMaterial(wallMaterialRef.current, {
                flowSpeed,
                mossCoverage: 1.0,
                highWaterMark,
                highWaterIntensity,
            }, state.clock.elapsedTime);
        } else if (wallMaterialRef.current) {
            updateRiverMaterial(wallMaterialRef.current, state.clock.elapsedTime, {
                waterLevel: WALL_WATERLINE_Y,
                weatherWetness: weatherWetnessRef?.current || 0,
            }, 1);
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
            {isSlotCanyon && (
                <hemisphereLight
                    skyColor="#ff8c4a"
                    groundColor="#3d1a0a"
                    intensity={0.55}
                />
            )}
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

            {showCanyonBackground && (
                <CanyonBackground
                    segmentId={segmentId}
                    segmentCenter={segmentCenterRef.current}
                    baseColor={biomeProfile.id === 'slotCanyon' ? '#bf5e2a' : biomeProfile.rockBaseColor}
                    biome={biome}
                />
            )}

            {biome === 'summer' && sandBarGeometry && (
                <mesh geometry={sandBarGeometry} material={sandBarMaterial} receiveShadow />
            )}

            <FlowingWater
                geometry={waterGeometry}
                flowSpeed={flowSpeed}
                biome={biome}
                isNight={isNight}
                baseColor={isGlacier ? '#a8d8ea' : (type === 'pond' ? '#1a4b6a' : undefined)}
                foamColor={isGlacier ? '#e8f6ff' : undefined}
                edgeHighlightColor={isGlacier ? '#c8eeff' : undefined}
                flowMap={flowMap}
                vehiclePos={vehiclePos}
                vehicleVelocity={vehicleVelocity}
                waterSurfaceOffset={waterSurfaceOffset}
            />

            {/* Glacier: ice-crystal spray bursts at the segment midpoint, scale with player speed */}
            {isGlacier && active && (
                <IceSpray
                    origin={vehiclePos}
                    intensity={Math.min(1, playerVelocityForParticles / 8)}
                    active={vehiclePos.distanceTo(segmentCenterRef.current) < 60}
                />
            )}

            {plungeImpactPlacement && (
                <group position={plungeImpactPlacement.position}>
                    <WaterfallImpactZone
                        width={plungeImpactPlacement.width}
                        flowSpeed={flowSpeed * (type === 'waterfall' ? 1.4 : 1.05)}
                        intensity={plungeImpactPlacement.intensity}
                        particleDensity={particleDensity}
                        playerVelocity={playerVelocityForParticles}
                    />
                </group>
            )}

            {type === 'splash' && rainbowPlacement && rainbowOpacity > 0.02 && (
                <group
                    position={rainbowPlacement.position}
                    rotation={rainbowPlacement.rotation}
                >
                    <Rainbow opacity={rainbowOpacity} sunDirection={sunWorldPosition} />
                </group>
            )}

            {isSlotCanyon && segmentPath && (
                <CanyonDecorations
                    riverPath={segmentPath}
                    trackWidth={biomeProfile.canyonWidth}
                    wallHeight={biomeProfile.wallHeight}
                    segmentSeed={segmentId * 137}
                    wallTightness={biomeProfile.wallTightness}
                    waterLevel={waterLevel}
                    rockDensityBias={biomeProfile.decorationBias?.rocks ?? 1.0}
                    onRockFoamUpdate={handleCanyonRockFoamUpdate}
                />
            )}

            <Rock
                transforms={usePooledStaticObstacles ? [] : placementData.rocks}
                scatterTransforms={placementData.scatterRocks}
                material={rockMaterial}
            />

            {/* Vegetation - Trees with Sway (ref for draw-distance culling) */}
            <group ref={vegetationGroupRef}>
                {isSlotCanyon ? (
                    <>
                        <Cactus transforms={placementData.cactus} />
                        <DesertSage transforms={placementData.desertSage} />
                        <CanyonGrass transforms={placementData.canyonGrass} />
                    </>
                ) : (
                    <Vegetation transforms={placementData.trees} biome={biome} />
                )}

            {/* Grass Bushes */}
            <Grass transforms={placementData.grass} biome={biome} />

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
            <Mist
                transforms={placementData.mist}
                flowSpeed={flowSpeed}
                playerVelocityRef={playerVelocityRef}
                isSlotCanyon={isSlotCanyon}
            />

            {isSlotCanyon && allowCanyonDust && (
                <CanyonDust
                    transforms={placementData.canyonDust}
                    playerVelocityRef={playerVelocityRef}
                    flowSpeed={flowSpeed}
                    count={64}
                    maxDistance={30}
                />
            )}

            {/* Fireflies */}
            <Fireflies transforms={placementData.fireflies} />

            {/* Dragonflies */}
            <Dragonflies transforms={placementData.dragonflies} />

            {/* Birds */}
            <Birds transforms={placementData.birds} birdType={birdType} isNight={isNight || batsActive} />

            <Bats transforms={placementData.bats} visible={batsActive} waterLevel={waterLevel} />

            {/* Fish (ponds/deep water) */}
            <Fish transforms={placementData.fish} />

            {/* Rapids - Whitewater foam */}
            <Rapids transforms={placementData.rapids} flowSpeed={flowSpeed} />

            {/* Rock Foam - Wake effects around rocks */}
            <RockFoam transforms={mergedRockFoam} flowSpeed={flowSpeed} />

            {/* Sun Shafts - Atmospheric light rays */}
            <SunShafts transforms={placementData.sunShafts} flowSpeed={flowSpeed} isSlotCanyon={isSlotCanyon} />
            </group>

            <group ref={rimVegetationGroupRef}>
                <Vegetation transforms={placementData.rimTrees} biome={biome} isRim={true} />
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
                    <WaterfallSheet
                        width={waterWidth}
                        height={20}
                        flowSpeed={flowSpeed * 1.35}
                        fanAngle={waterfallFanAngle}
                    />
                    <WaterfallParticles
                        count={particleCount || 300}
                        width={waterWidth}
                        height={20}
                        playerVelocity={playerVelocityForParticles}
                        particleDensity={particleDensity}
                        fanAngle={waterfallFanAngle}
                    />
                </group>
            )}
        </group>
    );
}
