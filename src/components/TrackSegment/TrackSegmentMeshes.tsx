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
import Icicles from '../Environment/Icicles';
import IceSheets from '../Environment/IceSheets';
import LumberProps from '../LumberProps';
import IndustrialProps from '../IndustrialProps';
import VortexVisual from '../VortexVisual';
import { effectiveVortexStrength } from '../../physics/vortexForces';

import { useLOD } from '../../systems/LODManager';
import { useBiome } from '../../systems/BiomeSystem';
import { useSunPosition } from '../../systems/lighting/SunPositionSystem';
import { getTrackBiomeProfile, isGlacialBiome } from '../../configs/TrackBiomes';
import { isAutumnLike, isSummerLike } from '../../configs/biomes';
import { WALL_WATERLINE_Y } from '../../constants/game';
import {
    createRiverSurfaceMaterial,
    updateRiverSurfaceMaterial,
} from '../../materials/river/createRiverSurfaceMaterial';
import {
    createCanyonSurfaceMaterial,
    updateCanyonSurfaceMaterial,
} from '../../materials/canyon/createCanyonSurfaceMaterial';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import PondFog from './PondFog';
import { hasFiniteCoordinates, SLOT_CANYON_STRATA } from './utils';
import type { TrackSegmentMeshesProps } from './types';
import {
    resolveSegmentFriction,
    resolveSegmentRestitution,
} from '../../systems/survival/surfaceFriction';

type WallMaterial = THREE.Material & {
  uniforms?: Record<string, { value: unknown }>;
};

export function TrackSegmentMeshes({
    segmentId,
    active,
    canyonGeometry,
    collisionGeometry,
    wallShellGeometry,
    waterGeometry,
    rockMaterial,
    waterLevel,
    flowSpeed,
    type,
    segmentState,
    slipperiness = 0,
    placementData,
    biome,
    waterfallPos,
    plungeImpactPlacement,
    particleCount,
    particleDensity = 0,
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
    config,
}: TrackSegmentMeshesProps) {
    const { quality: lodQuality } = useLOD();
    const { timeOfDay } = useBiome();
    const { sunWorldPosition } = useSunPosition();
    const waterSurfaceOffset = (segmentState === 'downhill' || verticalBias <= -1.2) ? 0.6 : 0;
    const waterfallFanAngle = (type === 'waterfall' && (particleCount || 0) >= 500) ? 60 : 0;
    const biomeProfile = useMemo(() => getTrackBiomeProfile(biome), [biome]);
    const isGlacier = isGlacialBiome(biome, biomeProfile);
    const isLumberFlume = biomeProfile.id === 'lumberFlume';
    const isHydroDam = biomeProfile.id === 'hydroDam';
    const openFloor = Boolean(config?.openFloor) || Boolean(config?.washedOutGap);
    const vortexConfig = config?.vortex;
    const catwalkWashedOut = Boolean(config?.washedOutGap) && Boolean(config?.hasBridge);
    const slushiness = isGlacier ? (biomeProfile.id === 'glacialMelt' ? 0.85 : 0.55) : 0;
    const birdType = biomeProfile.id === 'slotCanyon' ? 'hawk' : 'songbird';
    const batsActive = (biomeProfile.id === 'slotCanyon' || isAutumnLike(biome) || biome === 'canyon') && timeOfDay > 0.65;
    const showCanyonBackground = biomeProfile.id === 'slotCanyon' || biome === 'canyon';
    // Clone material for wall to apply RiverShader effects
    const wallMaterialRef = useRef<WallMaterial | null>(null);

    // Static lumber debris positions (v1 — visual only, not breakable)
    const lumberPropPositions = useMemo(() => {
      if (!isLumberFlume) return [];
      const fromDriftwood = (placementData.driftwood || [])
        .slice(0, 10)
        .map((t) => t.position.clone());
      if (fromDriftwood.length > 0) return fromDriftwood;
      // Fallback: a few props along the segment centerline
      if (!segmentPath || pathLength <= 0) return [];
      return [0.2, 0.45, 0.7].map((t) => {
        const p = segmentPath.getPoint(t);
        p.y = waterLevel + 0.15;
        return p;
      });
    }, [isLumberFlume, placementData.driftwood, segmentPath, pathLength, waterLevel]);

    // Industrial props for Hydro-Dam (pipes / railings / catwalks / gates)
    const industrialPositions = useMemo(() => {
      if (!isHydroDam || !segmentPath || pathLength <= 0) {
        return { pipes: [] as THREE.Vector3[], railings: [] as THREE.Vector3[], catwalks: [] as THREE.Vector3[], gates: [] as THREE.Vector3[] };
      }
      const sample = (ts: number[], lateral: number, yOff: number) =>
        ts.map((t) => {
          const p = segmentPath.getPoint(t);
          const tangent = segmentPath.getTangent(t).normalize();
          const binormal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
          p.addScaledVector(binormal, lateral);
          p.y = waterLevel + yOff;
          return p;
        });
      return {
        pipes: sample([0.2, 0.55, 0.85], 4.5, 1.2),
        railings: sample([0.3, 0.6], 3.2, 1.6),
        catwalks: config?.hasBridge ? sample([0.5], 0, 2.2) : sample([0.45], 2.8, 1.8),
        gates: vortexConfig ? sample([vortexConfig.centerT ?? 0.55], 0, 1.4) : [],
      };
    }, [isHydroDam, segmentPath, pathLength, waterLevel, config?.hasBridge, vortexConfig]);

    const vortexCenter = useMemo(() => {
      if (!vortexConfig || !segmentPath) return null;
      const t = THREE.MathUtils.clamp(vortexConfig.centerT ?? 0.55, 0, 1);
      const p = segmentPath.getPoint(t);
      const tangent = segmentPath.getTangent(t).normalize();
      const binormal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      p.addScaledVector(binormal, vortexConfig.lateralOffset ?? 0);
      return p;
    }, [vortexConfig, segmentPath]);

    const vortexVisualIntensity = useMemo(() => {
      if (!vortexConfig) return 0;
      return effectiveVortexStrength(segmentState, flowSpeed);
    }, [vortexConfig, segmentState, flowSpeed]);

    // Track player velocity via ref for shader-driven effects without per-frame re-rendering.
    const playerVelocityRef = useRef(0);
    const [playerVelocityForParticles, setPlayerVelocityForParticles] = useState(0);
    const playerVelocitySyncAccumulator = useRef(0);
    const [canyonRockFoam, setCanyonRockFoam] = useState<
      Array<{ position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }>
    >([]);

    // Vehicle position/velocity for FlowingWater
    const vehiclePos = useMemo(() => new THREE.Vector3(), []);
    const vehicleVelocity = useMemo(() => new THREE.Vector3(), []);

    // Pond draw distance culling (Goal 3)
    const vegetationGroupRef = useRef<THREE.Group>(null);
    const rimVegetationGroupRef = useRef<THREE.Group>(null);
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

    const handleCanyonRockFoamUpdate = useCallback((foamTransforms: unknown) => {
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
        if (segmentState === 'WashedOut') return 0.42;
        if (segmentState === 'Flooded') return 0.32;
        if (segmentState === 'HighFlow') return 0.24;
        return 0.15;
    }, [segmentState]);

    const highWaterIntensity = useMemo(() => {
        if (segmentState === 'WashedOut') return 1.0;
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
        if (!isSummerLike(biome) || !Array.isArray(placementData.sandBars) || placementData.sandBars.length === 0) {
            return null;
        }

        const positions: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
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

    const wallMaterial = useMemo((): WallMaterial | null => {
        if (!rockMaterial) return null;

        if (isSlotCanyon) {
            return createCanyonSurfaceMaterial(resolveMaterialBackend().backend, {
                biome: 'slotCanyon',
                wallHeight: biomeProfile.wallHeight || 26,
                parallaxScale: 0.025,
                flowSpeed,
                mossCoverage: 1.0,
                highWaterMark: segmentState === 'WashedOut' ? 0.42 : segmentState === 'Flooded' ? 0.35 : segmentState === 'HighFlow' ? 0.25 : 0.15,
                highWaterIntensity,
                strata: SLOT_CANYON_STRATA,
            }) as WallMaterial;
        }

        return createRiverSurfaceMaterial(resolveMaterialBackend().backend, rockMaterial.clone(), {
            enableWetness: true,
            enableMoss: true,
            enableTriplanar: true,
            waterLevel: WALL_WATERLINE_Y,
            wetnessRange: type === 'waterfall' || type === 'splash' ? 7.5 : 4.0
        }) as WallMaterial;
    }, [biomeProfile.wallHeight, flowSpeed, highWaterIntensity, highWaterMark, isSlotCanyon, rockMaterial, type, segmentState]);

    wallMaterialRef.current = wallMaterial;

    // Update shader uniforms each frame
    useFrame((state) => {
        // No `.uniforms` test here: the TSL canyon material keeps its uniform
        // bag in userData, and the host dispatches on whichever it was handed.
        if (isSlotCanyon && wallMaterialRef.current) {
            updateCanyonSurfaceMaterial(wallMaterialRef.current, {
                flowSpeed,
                mossCoverage: 1.0,
                highWaterMark,
                highWaterIntensity,
            }, state.clock.elapsedTime);
        } else if (wallMaterialRef.current) {
            updateRiverSurfaceMaterial(wallMaterialRef.current, state.clock.elapsedTime, {
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
            {isSlotCanyon && (
                <hemisphereLight
                    color="#ff8c4a"
                    groundColor="#3d1a0a"
                    intensity={0.55}
                />
            )}
            {/* Visual canyon — no Rapier collider (physics uses low-poly collisionGeometry). */}
            <mesh geometry={canyonGeometry} material={rockMaterial} />

            {/* Collision-only U-profile (~1/4 visual density). Invisible; preserves wallFriction / flood friction.
                openFloor gaps skip the trimesh so the player flies an air corridor. */}
            {!openFloor && (
            <RigidBody
                key={`rb-collision-${segmentId}`}
                type="fixed"
                colliders="trimesh"
                friction={resolveSegmentFriction({
                    baseFriction: biomeProfile.wallFriction,
                    slipperiness,
                    segmentState,
                })}
                restitution={resolveSegmentRestitution(
                    biomeProfile.id === 'slotCanyon' ? 0.02 : 0.1,
                    slipperiness,
                )}
            >
                <mesh geometry={collisionGeometry} visible={false} />
            </RigidBody>
            )}

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

            <mesh geometry={wallShellGeometry} material={wallMaterial ?? undefined} />

            {showCanyonBackground && (
                <CanyonBackground
                    segmentId={segmentId}
                    segmentCenter={segmentCenterRef.current}
                    baseColor={biomeProfile.id === 'slotCanyon' ? '#bf5e2a' : biomeProfile.rockBaseColor}
                    biome={biome}
                />
            )}

            {isSummerLike(biome) && sandBarGeometry && (
                <mesh geometry={sandBarGeometry} material={sandBarMaterial} receiveShadow />
            )}

            <FlowingWater
                geometry={waterGeometry}
                flowSpeed={flowSpeed}
                biome={biome}
                isNight={isNight}
                slushiness={slushiness}
                baseColor={
                  isHydroDam
                    ? '#2a4a5a'
                    : isGlacier
                      ? '#a8d8ea'
                      : (type === 'pond' ? '#1a4b6a' : undefined)
                }
                foamColor={isGlacier ? '#e8f6ff' : isHydroDam ? '#c0d0d8' : undefined}
                edgeHighlightColor={isGlacier ? '#c8eeff' : isHydroDam ? '#7a9aaa' : undefined}
                flowMap={flowMap}
                vehiclePos={vehiclePos}
                vehicleVelocity={vehicleVelocity}
                waterSurfaceOffset={waterSurfaceOffset}
                sunWorldPosition={sunWorldPosition}
                isPond={type === 'pond'}
                vortexCenter={vortexCenter ?? undefined}
                vortexRadius={vortexConfig?.radius}
                vortexIntensity={vortexVisualIntensity}
            />

            {vortexCenter && vortexConfig && (
                <VortexVisual
                    center={vortexCenter}
                    radius={vortexConfig.radius}
                    intensity={vortexVisualIntensity}
                    particleCount={56}
                    color="#5a9ae9"
                />
            )}

            {/* Glacier: ice-crystal spray bursts at the segment midpoint, scale with player speed */}
            {isGlacier && active && (
                <IceSpray
                    origin={vehiclePos}
                    intensity={Math.min(1, playerVelocityForParticles / 8)}
                    active={vehiclePos.distanceTo(segmentCenterRef.current) < 60}
                />
            )}

            {isGlacier && (
                <>
                    <Icicles transforms={placementData.icicles} />
                    <IceSheets transforms={placementData.iceSheets} />
                </>
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
                material={rockMaterial as THREE.MeshStandardMaterial}
                castShadow={lodQuality !== 'high'}
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

            {/* Lumber Flume static plank / log / barrel props (v1 visual only) */}
            {isLumberFlume && lumberPropPositions.length > 0 && (
                <>
                    <LumberProps type="plank" positions={lumberPropPositions.slice(0, 4)} />
                    <LumberProps type="log" positions={lumberPropPositions.slice(2, 6)} />
                    <LumberProps type="barrel" positions={lumberPropPositions.slice(5, 8)} />
                </>
            )}

            {/* Hydro-Dam industrial set dressing */}
            {isHydroDam && (
                <>
                    <IndustrialProps type="pipe" positions={industrialPositions.pipes} />
                    <IndustrialProps
                      type="railing"
                      positions={industrialPositions.railings}
                      washedOut={catwalkWashedOut}
                    />
                    <IndustrialProps
                      type="catwalk"
                      positions={industrialPositions.catwalks}
                      washedOut={catwalkWashedOut}
                    />
                    <IndustrialProps type="gate" positions={industrialPositions.gates} />
                </>
            )}

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
