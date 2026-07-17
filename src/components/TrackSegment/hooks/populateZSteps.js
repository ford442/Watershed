import * as THREE from 'three';
import { createFlowerPayload, createRockPayload, lerpValue, smoothNoise, pickTreeSpecies, seededRandom } from '../utils';
import { WATER_LEVEL } from '../../../constants/game';
import { populateSide } from './populateSide';

export function populateZSteps(args) {
    const {
        zSteps, geoLength, segmentPath, channelShapeFn,
        bankStart, canyonWidth, waterWidth, biome, segmentId, rng,
        type, config, flowSpeed, isSlotCanyon, biomeProfile,
        trees, rocks, scatterRocks, cactus, desertSage, grass, canyonGrass,
        wildflowers, reeds, driftwood, leaves, floatingLeaves, fireflies,
        birds, bats, fish, pebbles, sandBars, mist, waterLilies, sunShafts,
        ferns, rapids, dragonflies, pinecones, mushrooms, rimTrees, rockFoam, canyonDust,
        icicles, iceSheets
    } = args;
    const getChannelShape = channelShapeFn;
    const waterLevel = WATER_LEVEL;
    const lodQuality = config?.lodQuality || 'high';
    const particleCount = config?.particleCount || 100;

    const seedState = { value: segmentId * 1000 };

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
                populateSide({
                    side, t, zLocal, geoLength, segmentPath, channelShape, bankStart, canyonWidth, waterWidth, waterLevel,
                    biome, segmentId, rng, type, config, flowSpeed, isSlotCanyon, biomeProfile,
                    trees, rocks, scatterRocks, cactus, desertSage, grass, canyonGrass,
                    wildflowers, reeds, driftwood, leaves, floatingLeaves, fireflies,
                    birds, bats, fish, pebbles, sandBars, mist, waterLilies, sunShafts,
                    ferns, rapids, dragonflies, pinecones, mushrooms, rimTrees, rockFoam, canyonDust,
                    icicles, iceSheets,
                    pathPoint, tangent, binormal, up, seedState, lodQuality, particleCount, curvatureStrength, insideSide, tNext, tangentNext
                });
            }
        }

        // Rim tree silhouettes: sparse, irregular placements along wall tops.
        const rimSides = [-1, 1];
        for (let sideIdx = 0; sideIdx < rimSides.length; sideIdx++) {
            const side = rimSides[sideIdx];
            const perSideCount = isSlotCanyon
                ? 3 + Math.floor(seededRandom(seedState.value++) * 2) // 3-4
                : 3 + Math.floor(seededRandom(seedState.value++) * 4); // 3-6

            for (let i = 0; i < perSideCount && rimTrees.length < 12; i++) {
                const baseT = (i + 0.5) / perSideCount;
                const t = Math.max(0.03, Math.min(0.97, baseT + (seededRandom(seedState.value++) - 0.5) * 0.28));
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
                position.y += wallTopY - 1.8 + seededRandom(seedState.value++) * 1.3;

                const baseScale = isSlotCanyon
                    ? 0.85 + seededRandom(seedState.value++) * 0.65
                    : 1.0 + seededRandom(seedState.value++) * 1.1;
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
                    rotation: new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0),
                    scale,
                    ...treeSpecies,
                });
            }
        }

        if (isSlotCanyon || biome === 'autumn') {
            const minBats = 6;
            if (bats.length < minBats) {
                const maxBats = 12;
                const targetBatCount = minBats + Math.floor(seededRandom(seedState.value++) * (maxBats - minBats + 1));
                const missing = targetBatCount - bats.length;
                for (let i = 0; i < missing; i++) {
                    const t = Math.max(0.02, Math.min(0.98, seededRandom(seedState.value++)));
                    const pathPoint = segmentPath.getPoint(t);
                    const tangent = segmentPath.getTangent(t).normalize();
                    const up = new THREE.Vector3(0, 1, 0);
                    const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();
                    const wallSign = seededRandom(seedState.value++) > 0.5 ? 1 : -1;
                    const creviceOffset = isSlotCanyon
                        ? wallSign * (waterWidth * 0.46 + seededRandom(seedState.value++) * 2.1)
                        : wallSign * (bankStart + 4.0 + seededRandom(seedState.value++) * 4.0);
                    const batPos = new THREE.Vector3().copy(pathPoint);
                    batPos.add(binormal.multiplyScalar(creviceOffset));
                    batPos.y = waterLevel + 2 + seededRandom(seedState.value++) * 2.0;
                    bats.push({
                        position: batPos,
                        rotation: new THREE.Euler(),
                        scale: new THREE.Vector3(1, 1, 1),
                    });
                }
            }
        }


}
