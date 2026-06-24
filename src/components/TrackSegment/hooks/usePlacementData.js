import { populateZSteps } from './populateZSteps';
import { useMemo } from 'react';
import * as THREE from 'three';
import { SeededRandom } from '../../../systems/MapSystem';
import { createFlowerPayload, createRockPayload, lerpValue, smoothNoise } from '../utils';
import { WATER_LEVEL } from '../../../constants/game';

export function usePlacementData({
    active, segmentPath, segmentId, type, pathLength,
    waterWidth, canyonWidth, biome, config, channelProfile, bankStartOverride, flowSpeed,
    biomeProfile
}) {
    const isSlotCanyon = biomeProfile?.id === 'slotCanyon';

    const placementData = useMemo(() => {
        if (!active || !segmentPath) {
            return {
                rocks: [],
                scatterRocks: [],
                trees: [],
                cactus: [],
                desertSage: [],
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

        const seedState = { value: segmentId * 1000 };
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


        // Split out loop execution to avoid massive function body
        populateZSteps({
            zSteps, geoLength, segmentPath, channelShapeFn: getChannelShape,
            bankStart, canyonWidth, waterWidth, biome, segmentId, rng,
            type, config, flowSpeed, isSlotCanyon, biomeProfile,
            // Mutating lists:
            trees, rocks, scatterRocks, cactus, desertSage, grass, canyonGrass,
            wildflowers, reeds, driftwood, leaves, floatingLeaves, fireflies,
            birds, bats, fish, pebbles, sandBars, mist, waterLilies, sunShafts,
            ferns, rapids, dragonflies, pinecones, mushrooms, rimTrees, rockFoam, canyonDust
        });



        return { rocks, scatterRocks, trees, cactus, desertSage, grass, canyonGrass, wildflowers, reeds, driftwood, leaves, floatingLeaves, fireflies, birds, bats, fish, pebbles, sandBars, mist, waterLilies, sunShafts, ferns, rapids, dragonflies, pinecones, mushrooms, rimTrees, rockFoam, canyonDust };
    }, [segmentId, pathLength, segmentPath, canyonWidth, waterWidth, WATER_LEVEL, biome, type, flowSpeed, config, isSlotCanyon, biomeProfile]);

    return placementData;
}
