import * as THREE from 'three';
import { createFlowerPayload, createRockPayload, lerpValue, smoothNoise, pickTreeSpecies, seededRandom } from '../utils';
import { WATER_LEVEL } from '../../../constants/game';

export function populateSidePart1(args) {
    const {
        side, t, zLocal, geoLength, segmentPath, channelShape, bankStart, canyonWidth, waterWidth, waterLevel,
        biome, segmentId, rng, type, config, flowSpeed, isSlotCanyon, biomeProfile,
        trees, rocks, scatterRocks, cactus, desertSage, debris, grass, canyonGrass,
        wildflowers, reeds, driftwood, leaves, floatingLeaves, fireflies,
        birds, bats, fish, pebbles, sandBars, mist, waterLilies, sunShafts,
        ferns, rapids, dragonflies, pinecones, mushrooms, rimTrees, rockFoam, canyonDust,
        pathPoint, tangent, binormal, up, seedState, lodQuality, particleCount, curvatureStrength, insideSide, tNext, tangentNext
    } = args;
    const isPond = type === 'pond';
    const bankEdge = side < 0 ? channelShape.leftHalfWidth : channelShape.rightHalfWidth;
    const rockDef = config?.decorations?.rocks;
    const treeDef = config?.decorations?.trees;
    const rockDensity = config?.rockDensity ?? biomeProfile?.rockDensity ?? 'low';
    const treeDensity = config?.treeDensity ?? biomeProfile?.treeDensity ?? 1;
    const isGlacier = biomeProfile?.id === 'glacier' || biome === 'glacier';






                // 1. ROCKS (Large) — skip if explicit authored positions provided
                if (!Array.isArray(rockDef)) {
                const rockChanceMultipliers = { low: 0.4, high: 0.7 };
                const riffleBoost = Math.max(0, channelShape.riffleStrength) * 0.22;
                const rockChance = isPond ? 0.3 : (isSlotCanyon ? 0.8 : (rockChanceMultipliers[rockDensity] || 0.4) + riffleBoost);
                if (seededRandom(seedState.value++) > (1.0 - rockChance)) {
                    const dist = bankEdge + 0.6 + seededRandom(seedState.value++) * (2.6 + Math.max(0, channelShape.riffleStrength) * 1.5);
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;

                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;

                    if (Math.abs(xLocal) < bankStart + 2) yHeight *= 0.1;

                    const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3;
                    yHeight += rockNoise * (0.5 + normalizedDist);

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight;

                    const scale = 0.8 + seededRandom(seedState.value++) * 0.8;
                    const rotation = new THREE.Euler(
                        seededRandom(seedState.value++) * Math.PI,
                        seededRandom(seedState.value++) * Math.PI,
                        seededRandom(seedState.value++) * Math.PI
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

                    const scatterCount = 2 + Math.floor(seededRandom(seedState.value++) * 4);
                    for (let sr = 0; sr < scatterCount; sr++) {
                        const scatterPos = position.clone()
                            .add(tangent.clone().multiplyScalar((seededRandom(seedState.value++) - 0.5) * 2.4))
                            .add(binormal.clone().multiplyScalar((seededRandom(seedState.value++) - 0.5) * 2.2));
                        scatterPos.y = Math.max(waterLevel + 0.04, position.y - 0.2 + seededRandom(seedState.value++) * 0.35);
                        scatterRocks.push(createRockPayload({
                            position: scatterPos,
                            rotation: new THREE.Euler(
                                seededRandom(seedState.value++) * Math.PI,
                                seededRandom(seedState.value++) * Math.PI * 2,
                                seededRandom(seedState.value++) * Math.PI
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
                        if (seededRandom(seedState.value++) > (1.0 - ledgeChance)) {
                            const dryLedgeDist = bankStart + (canyonWidth * 0.22) + seededRandom(seedState.value++) * (canyonWidth * 0.16);
                            if (dryLedgeDist > waterWidth * 0.6) {
                                const offset = binormal.clone().multiplyScalar(side * dryLedgeDist);
                                const xLocal = side * dryLedgeDist;
                                const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                                let ledgeHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 10.5;
                                ledgeHeight += Math.sin(zLocal * 0.12 + xLocal * 0.18) * 0.8;

                                const position = new THREE.Vector3().copy(pathPoint).add(offset);
                                position.y += ledgeHeight + 0.25;
                                const rotation = new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0);

                                if (seededRandom(seedState.value++) > 0.5) {
                                    const scale = 0.7 + seededRandom(seedState.value++) * 0.6;
                                    cactus.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                                } else {
                                    const scale = 0.9 + seededRandom(seedState.value++) * 0.7;
                                    desertSage.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                                }
                            }
                        }
                    } else {
                        const baseTreeChance = (biome === 'autumn' || isPond) ? 0.6 : 0.3;
                        const treeChance = baseTreeChance * treeDensity;
                        if (seededRandom(seedState.value++) > (1.0 - treeChance)) {
                            const dist = bankStart + 4 + seededRandom(seedState.value++) * 8;
                            const offset = binormal.clone().multiplyScalar(side * dist);
                            const xLocal = side * dist;

                            const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                            let yHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                            yHeight += Math.sin(zLocal * 0.15) * Math.cos(xLocal * 0.3) * 1.5;

                            if (yHeight > 25) yHeight = 25 - seededRandom(seedState.value++) * 2;

                            const position = new THREE.Vector3().copy(pathPoint).add(offset);
                            position.y += yHeight - 0.5;

                            const scale = 1.5 + seededRandom(seedState.value++) * 1.0;
                            const rotation = new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0);
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

                            const numPinecones = 2 + Math.floor(seededRandom(seedState.value++) * 4);
                            for (let pc = 0; pc < numPinecones; pc++) {
                                const pcDist = 0.5 + seededRandom(seedState.value++) * 1.5;
                                const pcAngle = seededRandom(seedState.value++) * Math.PI * 2;

                                const pcPos = position.clone();
                                pcPos.x += Math.cos(pcAngle) * pcDist;
                                pcPos.z += Math.sin(pcAngle) * pcDist;
                                pcPos.y = position.y + 0.1;

                                const pcScale = 0.15 + seededRandom(seedState.value++) * 0.1;

                                pinecones.push({
                                    position: pcPos,
                                    rotation: new THREE.Euler(
                                        seededRandom(seedState.value++) * Math.PI,
                                        seededRandom(seedState.value++) * Math.PI,
                                        seededRandom(seedState.value++) * Math.PI
                                    ),
                                    scale: new THREE.Vector3(pcScale, pcScale, pcScale)
                                });
                            }
                        }
                    }
                } // end if (!Array.isArray(treeDef))

                // 3. DEBRIS
                if (seededRandom(seedState.value++) > 0.5) {
                    const dist = bankStart + seededRandom(seedState.value++) * 2;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 0.5;
                    debris.push({ position, rotation: new THREE.Euler(), scale: new THREE.Vector3(0.3, 0.3, 0.3) });
                }

                // 3.5 PEBBLES (New: Shoreline scatter)
                // High density, small objects along the water line
                if (seededRandom(seedState.value++) > 0.3) { // 70% chance per step
                    // Spawn a cluster of 1-3 pebbles
                    const clusterSize = 1 + Math.floor(seededRandom(seedState.value++) * 3);
                    for (let p = 0; p < clusterSize; p++) {
                        const dist = bankStart + seededRandom(seedState.value++) * 1.5; // Very close to water
                        const offset = binormal.clone().multiplyScalar(side * dist);
                        const position = new THREE.Vector3().copy(pathPoint).add(offset);

                        // Determine height (shoreline slope)
                        const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
                        let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                        if (Math.abs(side * dist) < bankStart + 2) groundY *= 0.1;

                        position.y += groundY + 0.1; // Slightly embedded

                        // Randomize scale
                        const scale = 0.5 + seededRandom(seedState.value++) * 0.6;
                        pebbles.push({
                            position,
                            rotation: new THREE.Euler(
                                seededRandom(seedState.value++) * Math.PI,
                                seededRandom(seedState.value++) * Math.PI,
                                seededRandom(seedState.value++) * Math.PI
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
                    seededRandom(seedState.value++) > 0.55
                ) {
                    const barWidth = 2.5 + seededRandom(seedState.value++) * 3.0;
                    const barLength = barWidth * (0.55 + seededRandom(seedState.value++) * 0.25);
                    const barOffset = bankStart * 0.58 + seededRandom(seedState.value++) * (bankStart * 0.32);
                    const center = pathPoint.clone().add(binormal.clone().multiplyScalar(side * barOffset));
                    center.y = waterLevel + 0.08 + seededRandom(seedState.value++) * 0.12;

                    sandBars.push({
                        center,
                        width: barWidth,
                        length: barLength,
                        tangent: tangent.clone(),
                        binormal: binormal.clone(),
                    });

                    // Pebble clusters on bars: denser than regular shoreline scatter.
                    const barPebbleCount = 3 + Math.floor(seededRandom(seedState.value++) * 5);
                    for (let pb = 0; pb < barPebbleCount; pb++) {
                        const along = (seededRandom(seedState.value++) - 0.5) * barLength * 1.7;
                        const across = (seededRandom(seedState.value++) - 0.5) * barWidth * 0.9;
                        const pebblePos = center.clone()
                            .add(tangent.clone().multiplyScalar(along))
                            .add(binormal.clone().multiplyScalar(across));
                        pebblePos.y = center.y + 0.02;
                        const scale = 0.45 + seededRandom(seedState.value++) * 0.55;
                        pebbles.push({
                            position: pebblePos,
                            rotation: new THREE.Euler(
                                seededRandom(seedState.value++) * Math.PI,
                                seededRandom(seedState.value++) * Math.PI,
                                seededRandom(seedState.value++) * Math.PI
                            ),
                            scale: new THREE.Vector3(scale, scale, scale)
                        });
                    }
                }

                // 4. GRASS
                if (!isSlotCanyon && !isGlacier && seededRandom(seedState.value++) > 0.6) {
                    const dist = bankStart + seededRandom(seedState.value++) * 4;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 1.0;
                    grass.push({ position, rotation: new THREE.Euler(0, rng.next(), 0), scale: new THREE.Vector3(0.5, 0.5, 0.5) });
                }

                // 4.1 CANYON GRASS (slot canyon waterline)
                if (isSlotCanyon && seededRandom(seedState.value++) > 0.48) {
                    const grassDist = bankStart + 0.6 + seededRandom(seedState.value++) * Math.max(0.4, bankStart * 0.35);
                    const offset = binormal.clone().multiplyScalar(side * grassDist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);

                    const normalizedDist = Math.abs(side * grassDist) / (canyonWidth * 0.45);
                    let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    if (Math.abs(side * grassDist) < bankStart + 2) groundY *= 0.1;

                    position.y += Math.max(waterLevel + 0.05, groundY + 0.08);
                    const scale = 0.55 + seededRandom(seedState.value++) * 0.45;
                    canyonGrass.push({
                        position,
                        rotation: new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0),
                        scale: new THREE.Vector3(scale, scale, scale)
                    });
                }

                // 4.5 WILDFLOWERS - denser near waterline with deterministic clumping.
                if (!isSlotCanyon && !isGlacier) {
                    const bankHeight = Math.max(1.5, biomeProfile.wallHeight * 0.55);
                    const minFlowerDist = bankStart + 0.35;
                    const maxFlowerDist = bankStart + Math.min(7.5, canyonWidth * 0.18);
                    const dist = minFlowerDist + seededRandom(seedState.value++) * Math.max(0.5, maxFlowerDist - minFlowerDist);
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;
                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    groundY += Math.sin(zLocal * 0.15) * Math.cos(xLocal * 0.3) * 1.5;
                    if (groundY > 25) groundY = 25 - seededRandom(seedState.value++) * 2;

                    const heightAboveWaterline = Math.max(0, (groundY - 0.5) - waterLevel);
                    const waterlineFactor = Math.min(1, heightAboveWaterline / bankHeight);
                    const highNearWater = biome === 'autumn' ? 0.52 : 0.72;
                    const lowAtRim = biome === 'autumn' ? 0.14 : 0.2;
                    const wildflowerBoost = (type === 'normal' && particleCount > 0) ? Math.min(particleCount / 60, 2.5) : 1.0;
                    const spawnProbability = (highNearWater + (lowAtRim - highNearWater) * waterlineFactor) * wildflowerBoost;

                    if (seededRandom(seedState.value++) < spawnProbability) {
                        const clusterSize = 2 + Math.floor(seededRandom(seedState.value++) * 3);
                        const baseScale = biome === 'autumn' ? 0.55 + seededRandom(seedState.value++) * 0.28 : 0.6 + seededRandom(seedState.value++) * 0.35;

                        for (let wf = 0; wf < clusterSize; wf++) {
                            const spreadAlong = wf === 0 ? 0 : (seededRandom(seedState.value++) - 0.5) * 1.2;
                            const spreadAcross = wf === 0 ? 0 : (seededRandom(seedState.value++) - 0.5) * 0.9;
                            const position = new THREE.Vector3().copy(pathPoint)
                                .add(offset)
                                .add(tangent.clone().multiplyScalar(spreadAlong))
                                .add(binormal.clone().multiplyScalar(spreadAcross));
                            position.y = Math.max(waterLevel + 0.05, groundY + 0.12 + seededRandom(seedState.value++) * 0.2);

                            const scaleMod = wf === 0 ? 1 : 0.78 + seededRandom(seedState.value++) * 0.32;
                            const flowerIndex = wildflowers.length;
                            wildflowers.push(createFlowerPayload({
                                position,
                                rotation: new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0),
                                scale: new THREE.Vector3(baseScale * scaleMod, baseScale * (0.9 + seededRandom(seedState.value++) * 0.4), baseScale * scaleMod),
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
                if (!isSlotCanyon && !isGlacier && seededRandom(seedState.value++) > (1.0 - fernChance)) {
                    // Spawn a cluster
                    const clusterSize = 3 + Math.floor(seededRandom(seedState.value++) * 3);

                    // Placement: Between water edge and wall, leaning towards wall
                    const baseDist = bankStart + 3 + seededRandom(seedState.value++) * 5;

                    for (let f = 0; f < clusterSize; f++) {
                        const spreadX = (seededRandom(seedState.value++) - 0.5) * 3.0;
                        const spreadZ = (seededRandom(seedState.value++) - 0.5) * 3.0;

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

                        const scale = 0.8 + seededRandom(seedState.value++) * 0.6;
                        ferns.push({
                            position,
                            rotation: new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0),
                            scale: new THREE.Vector3(scale, scale, scale)
                        });
                    }
                }


}
