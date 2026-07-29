import * as THREE from 'three';
import { createRockPayload, seededRandom } from '../utils';
import { isAutumnLike } from '../../../configs/biomes';
import type { PopulateSideArgs } from '../types';

export function populateSidePart2(args: PopulateSideArgs): void {
    const {
        side, zLocal, channelShape, bankStart, canyonWidth, waterWidth, waterLevel,
        biome, segmentId, type, config, flowSpeed, isSlotCanyon, biomeProfile,
        rocks, reeds, driftwood, leaves, floatingLeaves, fireflies,
        birds, bats, fish, mist, waterLilies, sunShafts,
        rapids, dragonflies, mushrooms, rockFoam, canyonDust,
        icicles, iceSheets,
        pathPoint, tangent, binormal, seedState, lodQuality, particleCount,
    } = args;
    const isPond = type === 'pond';
    const bankEdge = side < 0 ? channelShape.leftHalfWidth : channelShape.rightHalfWidth;
    const rockDensity = config?.rockDensity ?? biomeProfile?.rockDensity ?? 'low';
    const isGlacier = biomeProfile?.id === 'glacier' || biomeProfile?.id === 'glacialMelt'
        || biome === 'glacier' || biome === 'glacial' || biome === 'glacialMelt';
                // 4.7 MUSHROOMS (New: Forest floor detail)
                const mushroomChance = isAutumnLike(biome) ? 0.6 : 0.3;
                if (!isSlotCanyon && !isGlacier && seededRandom(seedState.value++) > (1.0 - mushroomChance)) {
                    // Cluster
                    const clusterSize = 3 + Math.floor(seededRandom(seedState.value++) * 5);
                    // Placement: Near trees or damp spots (between bank and wall)
                    const baseDist = bankStart + 2 + seededRandom(seedState.value++) * 5;

                    for (let m = 0; m < clusterSize; m++) {
                        const spreadX = (seededRandom(seedState.value++) - 0.5) * 1.5;
                        const spreadZ = (seededRandom(seedState.value++) - 0.5) * 1.5;

                        const dist = baseDist + spreadX;
                        const offset = binormal.clone().multiplyScalar(side * dist);
                        const zOffsetVec = tangent.clone().multiplyScalar(spreadZ);

                        const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zOffsetVec);

                        const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
                        let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                        if (Math.abs(side * dist) < bankStart + 2) groundY *= 0.1;
                        groundY += Math.sin(zLocal * 0.8 + (side * dist) * 0.5) * 0.3;

                        position.y += groundY; // Sit on ground

                        const scale = 0.8 + seededRandom(seedState.value++) * 0.6;
                        mushrooms.push({
                            position,
                            rotation: new THREE.Euler(
                                (seededRandom(seedState.value++) - 0.5) * 0.2,
                                seededRandom(seedState.value++) * Math.PI * 2,
                                (seededRandom(seedState.value++) - 0.5) * 0.2
                            ),
                            scale: new THREE.Vector3(scale, scale, scale)
                        });
                    }
                }

                // 5. REEDS
                if (!isSlotCanyon && !isGlacier && seededRandom(seedState.value++) > 0.5) {
                    const dist = bankStart + (seededRandom(seedState.value++) - 0.2) * 1.5;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);

                    const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
                    let groundY = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    if (Math.abs(side * dist) < bankStart + 2) groundY *= 0.1;

                    position.y += groundY - 0.2;

                    const scale = 0.8 + seededRandom(seedState.value++) * 0.4;
                    reeds.push({
                        position,
                        rotation: new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0),
                        scale: new THREE.Vector3(scale, scale, scale)
                    });
                }

                // 6. DRIFTWOOD (Enhanced Density)
                // Scatter new Driftwood instances along the river edge
                if (!isSlotCanyon && !isGlacier && seededRandom(seedState.value++) > 0.25) { // 75% chance per step (Significantly increased from 0.4)
                    // Chance for a larger pile (Log Jam)
                    const isPile = seededRandom(seedState.value++) > 0.7;
                    const clusterSize = isPile ? 3 + Math.floor(seededRandom(seedState.value++) * 4) : 1 + Math.floor(seededRandom(seedState.value++) * 2);

                    // Center of the cluster for this step
                    const baseDist = bankStart + (seededRandom(seedState.value++) - 0.1) * 3.0;

                    for (let d = 0; d < clusterSize; d++) {
                        // Spread logic
                        const offsetZ = (seededRandom(seedState.value++) - 0.5) * (isPile ? 3.0 : 1.5);
                        const offsetX = (seededRandom(seedState.value++) - 0.5) * (isPile ? 2.5 : 1.0);

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
                        const scaleMod = 0.7 + seededRandom(seedState.value++) * 0.8;

                        driftwood.push({
                            position,
                            rotation: new THREE.Euler(
                                (seededRandom(seedState.value++) - 0.5) * 0.5,
                                seededRandom(seedState.value++) * Math.PI * 2,
                                (seededRandom(seedState.value++) - 0.5) * 0.5
                            ),
                            scale: new THREE.Vector3(scaleMod, scaleMod, scaleMod)
                        });
                    }
                }

                // 7. LEAVES (Falling - Enhanced)
                const baseLeafChance = isAutumnLike(biome) ? 0.8 : 0.2;
                if (seededRandom(seedState.value++) > (1.0 - baseLeafChance)) {
                    // Determine count - More in autumn
                    const count = isAutumnLike(biome) ? 3 + Math.floor(seededRandom(seedState.value++) * 5) : 1;

                    for (let l = 0; l < count; l++) {
                        const dist = (seededRandom(seedState.value++) - 0.5) * canyonWidth * 0.9; // Wide spread
                        const offset = binormal.clone().multiplyScalar(dist);

                        // Add some random Z spread too
                        const zOffset = (seededRandom(seedState.value++) - 0.5) * 5.0;
                        const zVec = tangent.clone().multiplyScalar(zOffset);

                        const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zVec);
                        position.y += 15 + seededRandom(seedState.value++) * 10;

                        leaves.push({
                            position,
                            rotation: new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0),
                            scale: new THREE.Vector3(1, 1, 1)
                        });
                    }
                }

                // 7.5 FLOATING LEAVES (Pond Only)
                // Static/Drifting leaves on the water surface
                if (type === 'pond') {
                    if (seededRandom(seedState.value++) > 0.4) { // 60% chance per step
                        const count = 1 + Math.floor(seededRandom(seedState.value++) * 3);
                        for (let fl = 0; fl < count; fl++) {
                            const dist = (seededRandom(seedState.value++) - 0.5) * waterWidth * 0.9;
                            const offset = binormal.clone().multiplyScalar(dist);

                            // Spread Z
                            const zOffset = (seededRandom(seedState.value++) - 0.5) * 4.0;
                            const zVec = tangent.clone().multiplyScalar(zOffset);

                            const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zVec);
                            position.y = waterLevel; // Exact water level

                            floatingLeaves.push({
                                position,
                                rotation: new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0),
                                scale: new THREE.Vector3(1, 1, 1)
                            });
                        }
                    }
                }

                // 8. FIREFLIES
                if (seededRandom(seedState.value++) > 0.8) {
                    const dist = (seededRandom(seedState.value++) - 0.5) * canyonWidth * 0.9;
                    const offset = binormal.clone().multiplyScalar(dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 1.0 + seededRandom(seedState.value++) * 3.0;
                    fireflies.push({
                        position,
                        rotation: new THREE.Euler(),
                        scale: new THREE.Vector3(1, 1, 1)
                    });
                }

                // 9. BIRDS
                if (side === 1 && birds.length < 8) {
                    const targetBirdCount = isSlotCanyon
                        ? 2 + Math.floor(seededRandom(seedState.value++) * 3)
                        : 4 + Math.floor(seededRandom(seedState.value++) * 5);
                    const spawnChance = isSlotCanyon ? 0.18 : 0.12;

                    if (seededRandom(seedState.value++) < spawnChance) {
                        const birdPos = new THREE.Vector3().copy(pathPoint);

                        if (isSlotCanyon) {
                            const dist = (seededRandom(seedState.value++) - 0.5) * canyonWidth * 0.45;
                            birdPos.add(binormal.clone().multiplyScalar(dist));
                            birdPos.add(tangent.clone().multiplyScalar((seededRandom(seedState.value++) - 0.5) * 6.0));
                            birdPos.y += waterLevel + biomeProfile.wallHeight * 0.45 + seededRandom(seedState.value++) * 4.0;
                        } else {
                            const sideSign = seededRandom(seedState.value++) > 0.5 ? 1 : -1;
                            const dist = sideSign * (bankStart + 3 + seededRandom(seedState.value++) * 5.0);
                            birdPos.add(binormal.clone().multiplyScalar(dist));
                            birdPos.add(tangent.clone().multiplyScalar((seededRandom(seedState.value++) - 0.5) * 5.0));
                            birdPos.y += 5.5 + seededRandom(seedState.value++) * 4.0;
                        }

                        if ((isSlotCanyon || isAutumnLike(biome)) && bats.length < 12) {
                            const targetBatCount = 6 + Math.floor(seededRandom(seedState.value++) * 7);
                            const spawnChance = isSlotCanyon ? 0.5 : 0.42;
                            if (seededRandom(seedState.value++) < spawnChance) {
                                const wallSign = seededRandom(seedState.value++) > 0.5 ? 1 : -1;
                                const creviceOffset = isSlotCanyon
                                    ? wallSign * (waterWidth * 0.48 + seededRandom(seedState.value++) * 1.8)
                                    : wallSign * (bankStart + 4.5 + seededRandom(seedState.value++) * 4.0);
                                const batPos = new THREE.Vector3().copy(pathPoint);
                                batPos.add(binormal.clone().multiplyScalar(creviceOffset));
                                batPos.add(tangent.clone().multiplyScalar((seededRandom(seedState.value++) - 0.5) * 7.0));
                                batPos.y = waterLevel + 2 + seededRandom(seedState.value++) * 2.0;

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

                        if (!isSlotCanyon && birds.length < targetBirdCount && seededRandom(seedState.value++) < 0.5) {
                            const buddyPos = birdPos.clone();
                            buddyPos.x += (seededRandom(seedState.value++) - 0.5) * 2.5;
                            buddyPos.z += (seededRandom(seedState.value++) - 0.5) * 2.5;
                            buddyPos.y += (seededRandom(seedState.value++) - 0.5) * 1.2;
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
                    if (seededRandom(seedState.value++) > 0.6) {
                        const dist = (seededRandom(seedState.value++) - 0.5) * waterWidth * 0.8;
                        const offset = binormal.clone().multiplyScalar(dist);
                        const position = new THREE.Vector3().copy(pathPoint).add(offset);
                        position.y += waterLevel - 0.5;
                        fish.push({
                            position,
                            rotation: new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0),
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
                        if (seededRandom(seedState.value++) > floorChance) {
                            const floorClusterSize = lodQuality === 'low'
                                ? 1 + Math.floor(seededRandom(seedState.value++) * 2)
                                : 2 + Math.floor(seededRandom(seedState.value++) * 4);
                            for (let m = 0; m < floorClusterSize; m++) {
                                const dist = (seededRandom(seedState.value++) - 0.5) * waterWidth * 0.95;
                                const offset = binormal.clone().multiplyScalar(dist);
                                const position = new THREE.Vector3().copy(pathPoint).add(offset);
                                position.y = waterLevel + seededRandom(seedState.value++) * 2.0;
                                const sx = 2.0 + seededRandom(seedState.value++) * 2.0;
                                const sy = 1.2 + seededRandom(seedState.value++) * 1.4;
                                const sz = 1.5 + seededRandom(seedState.value++) * 1.5;
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
                        if (allowColumnMist && seededRandom(seedState.value++) > 0.6) {
                            const columnCount = 1 + Math.floor(seededRandom(seedState.value++) * 2);
                            for (let c = 0; c < columnCount; c++) {
                                const dist = (seededRandom(seedState.value++) - 0.5) * waterWidth * 0.5;
                                const offset = binormal.clone().multiplyScalar(dist);
                                const position = new THREE.Vector3().copy(pathPoint).add(offset);
                                position.y = waterLevel + 3.0 + seededRandom(seedState.value++) * 7.0;
                                const sx = 0.5 + seededRandom(seedState.value++) * 0.7;
                                const sy = 3.0 + seededRandom(seedState.value++) * 4.0;
                                mist.push({
                                    position,
                                    rotation: new THREE.Euler(),
                                    scale: new THREE.Vector3(sx, sy, 0.4 + seededRandom(seedState.value++) * 0.6),
                                    type: 'column',
                                });
                            }
                        }
                    } else {
                        const mistChance = 0.6;
                        if (seededRandom(seedState.value++) > mistChance) {
                            const clusterSize = 1 + Math.floor(seededRandom(seedState.value++) * 2);
                            for (let m = 0; m < clusterSize; m++) {
                                const dist = (seededRandom(seedState.value++) - 0.5) * waterWidth * 0.8;
                                const offset = binormal.clone().multiplyScalar(dist);
                                const position = new THREE.Vector3().copy(pathPoint).add(offset);
                                position.y = waterLevel + 0.2 + seededRandom(seedState.value++) * 2.0;
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
                    if (seededRandom(seedState.value++) > 0.85) { // Occasional clusters
                        const clusterSize = 3 + Math.floor(seededRandom(seedState.value++) * 5);
                        const baseDist = (seededRandom(seedState.value++) - 0.5) * waterWidth * 0.7; // Random spot on water

                        for (let l = 0; l < clusterSize; l++) {
                            const offsetSpread = 2.0;
                            const lx = baseDist + (seededRandom(seedState.value++) - 0.5) * offsetSpread;
                            const lz = (seededRandom(seedState.value++) - 0.5) * offsetSpread; // Local Z relative to cluster center

                            // Check bounds (roughly)
                            if (Math.abs(lx) > waterWidth / 2 - 2) continue; // Avoid bank clipping

                            const offset = binormal.clone().multiplyScalar(lx);
                            const zOffsetVec = tangent.clone().multiplyScalar(lz);

                            const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zOffsetVec);
                            position.y = waterLevel; // Sit on water

                            const scale = 0.8 + seededRandom(seedState.value++) * 0.4;
                            waterLilies.push({
                                position,
                                rotation: new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0),
                                scale: new THREE.Vector3(scale, scale, scale)
                            });
                        }
                    }
                }

                // 13. SUN SHAFTS (Atmospheric)
                // Rare rays of light piercing the canopy
                if (isSlotCanyon) {
                    // Slot canyon: dramatic narrow god rays from above
                    if (seededRandom(seedState.value++) > 0.68) { // More frequent in narrows
                        const dist = (seededRandom(seedState.value++) - 0.5) * waterWidth * 0.6;
                        const offset = binormal.clone().multiplyScalar(dist);
                        const position = new THREE.Vector3().copy(pathPoint).add(offset);

                        // Height: Start very high (tall canyon walls)
                        position.y = 20 + seededRandom(seedState.value++) * 8;

                        // Rotation: Nearly vertical to simulate light from narrow opening
                        const lightDir = new THREE.Vector3(0.1, 1, 0.05).normalize();
                        const up = new THREE.Vector3(0, 1, 0);
                        const q = new THREE.Quaternion().setFromUnitVectors(up, lightDir);
                        const rotation = new THREE.Euler().setFromQuaternion(q);

                        // Narrow, tall beams for slot canyon
                        const scaleMod = 0.4 + seededRandom(seedState.value++) * 0.3;

                        sunShafts.push({
                            position,
                            rotation,
                            scale: new THREE.Vector3(scaleMod * 0.5, scaleMod * 2.5, scaleMod * 0.5)
                        });
                    }
                } else if (!isAutumnLike(biome) || type === 'pond') { // More common in summer or open ponds
                    const isLumberFlume = biomeProfile?.id === 'lumberFlume' || biome === 'lumberFlume';
                    // Lumber flume: denser dappled canopy shafts
                    const shaftThreshold = isLumberFlume ? 0.72 : 0.92;
                    if (seededRandom(seedState.value++) > shaftThreshold) { // Occasional
                        const dist = (seededRandom(seedState.value++) - 0.5) * canyonWidth * 0.6;
                        const offset = binormal.clone().multiplyScalar(dist);
                        const position = new THREE.Vector3().copy(pathPoint).add(offset);

                        // Height: Start high up
                        position.y = 12 + seededRandom(seedState.value++) * 5;

                        // Rotation: Align with generic light direction (10, 20, 5)
                        const lightDir = new THREE.Vector3(10, 20, 5).normalize();
                        const up = new THREE.Vector3(0, 1, 0);
                        const q = new THREE.Quaternion().setFromUnitVectors(up, lightDir);
                        const rotation = new THREE.Euler().setFromQuaternion(q);

                        // Random scale for width/length variation
                        const scaleMod = 0.8 + seededRandom(seedState.value++) * 0.4;

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

                    if (seededRandom(seedState.value++) > (1.0 - rapidChance)) {
                        const clusterSize = 1 + Math.floor(seededRandom(seedState.value++) * 3);
                        // Place in center channel (avoid banks)
                        const centerSpread = channelShape.corridorHalfWidth * 1.4;

                        for (let r = 0; r < clusterSize; r++) {
                            const dist = (seededRandom(seedState.value++) - 0.5) * centerSpread;
                            const offset = binormal.clone().multiplyScalar(dist);

                            // Spread Z slightly
                            const zOffsetVec = tangent.clone().multiplyScalar((seededRandom(seedState.value++) - 0.5) * 2.0);

                            const position = new THREE.Vector3().copy(pathPoint).add(offset).add(zOffsetVec);
                            position.y = waterLevel - 0.1; // Sits in water

                            const scale = 0.8 + seededRandom(seedState.value++) * 0.8;

                            rapids.push({
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
                }

                // 15. DRAGONFLIES (Daytime activity near water)
                if (!isSlotCanyon && !isAutumnLike(biome) && type !== 'waterfall') {
                    if (seededRandom(seedState.value++) > 0.7) { // 30% chance per step
                        const clusterSize = 1 + Math.floor(seededRandom(seedState.value++) * 3);

                        // Place near banks
                        const dist = bankStart + (seededRandom(seedState.value++) - 0.5) * 4.0;
                        const offset = binormal.clone().multiplyScalar(side * dist);
                        const position = new THREE.Vector3().copy(pathPoint).add(offset);

                        // Height: Hovering 1-3m above
                        position.y = waterLevel + 1.0 + seededRandom(seedState.value++) * 2.0;

                        for (let d = 0; d < clusterSize; d++) {
                            // Slight spread
                            const dPos = position.clone();
                            dPos.x += (seededRandom(seedState.value++) - 0.5) * 1.0;
                            dPos.z += (seededRandom(seedState.value++) - 0.5) * 1.0;
                            dPos.y += (seededRandom(seedState.value++) - 0.5) * 0.5;

                            dragonflies.push({
                                position: dPos,
                                rotation: new THREE.Euler(0, seededRandom(seedState.value++) * Math.PI * 2, 0),
                                scale: new THREE.Vector3(1, 1, 1)
                            });
                        }
                    }
                }

                // 16. GLACIAL — icicles on rim overhangs
                if (isGlacier && seededRandom(seedState.value++) > 0.55) {
                    const dist = side * (bankEdge + 1.8 + seededRandom(seedState.value++) * 3.5);
                    const offset = binormal.clone().multiplyScalar(dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    const normalizedDist = Math.abs(dist) / (canyonWidth * 0.45);
                    let rimY = Math.pow(Math.max(0, normalizedDist), 2.2) * (biomeProfile?.wallHeight ?? 20);
                    rimY += 2.0 + seededRandom(seedState.value++) * 4.0;
                    position.y += rimY;
                    const scaleY = 1.2 + seededRandom(seedState.value++) * 2.8;
                    icicles.push({
                        position,
                        rotation: new THREE.Euler(
                            (seededRandom(seedState.value++) - 0.5) * 0.15,
                            seededRandom(seedState.value++) * Math.PI * 2,
                            (seededRandom(seedState.value++) - 0.5) * 0.1,
                        ),
                        scale: new THREE.Vector3(0.7 + seededRandom(seedState.value++) * 0.6, scaleY, 0.7 + seededRandom(seedState.value++) * 0.5),
                    });
                }

                // 17. GLACIAL — translucent ice shelves at the waterline
                if (isGlacier && seededRandom(seedState.value++) > 0.62) {
                    const dist = side * (bankStart + 0.4 + seededRandom(seedState.value++) * 1.2);
                    const offset = binormal.clone().multiplyScalar(dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y = waterLevel + 0.05 + seededRandom(seedState.value++) * 0.15;
                    const span = 1.4 + seededRandom(seedState.value++) * 2.6;
                    iceSheets.push({
                        position,
                        rotation: new THREE.Euler(
                            (seededRandom(seedState.value++) - 0.5) * 0.2,
                            Math.atan2(tangent.x, tangent.z),
                            (seededRandom(seedState.value++) - 0.5) * 0.12,
                        ),
                        scale: new THREE.Vector3(span, 1, 0.5 + seededRandom(seedState.value++) * 0.8),
                    });
                }
}
