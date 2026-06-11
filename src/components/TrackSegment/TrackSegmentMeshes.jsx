import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CuboidCollider } from '@react-three/rapier';

import FlowingWater from '../FlowingWater';
import CanyonDecorations from '../CanyonDecorations';
import Vegetation from '../Environment/Vegetation';
import Grass from '../Environment/Grass';
import Foliage from '../Environment/Foliage';
import Reeds from '../Environment/Reeds';
import Driftwood from '../Environment/Driftwood';
import FallingLeaves from '../Environment/FallingLeaves';
import Fireflies from '../Environment/Fireflies';
import Birds from '../Environment/Birds';
import Bats from '../Environment/Bats';
import Fish from '../Environment/Fish';
import Pebbles from '../Environment/Pebbles';
import Mist from '../Environment/Mist';
import WaterLilies from '../Environment/WaterLilies';
import SunShafts from '../Environment/SunShafts';
import Rainbow from '../Environment/Rainbow';
import Ferns from '../Environment/Ferns';
import Rapids from '../Environment/Rapids';
import Dragonflies from '../Environment/Dragonflies';
import Pinecone from '../Environment/Pinecone';
import Mushrooms from '../Environment/Mushrooms';
import RockFoam from '../Environment/RockFoam';
import Wildflowers from '../Environment/Wildflowers';
import WaterfallParticles from '../Environment/WaterfallParticles';
import WaterfallSheet from '../Environment/WaterfallSheet';
import WaterfallImpactZone from '../Environment/WaterfallImpactZone';
import FloatingObjectManager from '../Environment/FloatingObjectManager';
import CanyonDust from '../Environment/CanyonDust';
import Cactus from '../Environment/Cactus';
import DesertSage from '../Environment/DesertSage';
import CanyonGrass from '../Environment/CanyonGrass';
import CanyonBackground from '../Environment/CanyonBackground';
import Rock from '../Obstacles/Rock';
import IceSpray from '../Environment/IceSpray';

import { useLOD } from '../../systems/LODManager';
import { useBiome } from '../../systems/BiomeSystem';
import { useSunPosition } from '../../systems/SunPositionSystem';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import { WALL_WATERLINE_Y } from '../../constants/game';
import { createCanyonMaterial } from '../../materials/CanyonMaterial';
import { extendRiverMaterial, updateRiverMaterial } from '../../utils/RiverShader';
import { AssetCache } from '../../systems/ReachStreamer';
import PondFog from './PondFog';
import { hasFiniteCoordinates, SLOT_CANYON_STRATA } from './utils';

export function TrackSegmentMeshes({
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
        if (!rockMaterial) return null;

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
            {type === 'pond' && <PondFog segmentCenter={segmentCenterRef.current} waterLevel={waterLevel} />}

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
                sunWorldPosition={sunWorldPosition}
                isPond={type === 'pond'}
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
