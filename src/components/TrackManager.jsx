import React, { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import TrackSegment from './TrackSegment';
import WaterFlowForces from './WaterFlowForces';
import VehicleTuner from './VehicleTuner';
import PooledObstacles from './PooledObstacles';
import { extendRiverMaterial } from '../utils/RiverShader';
import { WATER_LEVEL, REACH_API_BASE } from '../constants/game';
import { AssetCache } from '../systems/ReachStreamer';
import { useNightMode } from '../hooks/useNightMode';
import { DefaultMapManager, JSONMapManager } from '../systems/MapSystem';
import { MEANDER_TO_WATERFALL_PROGRESSION } from '../maps/meander_to_waterfall';
import { ChunkManager } from '../systems/ChunkManager';
import { createObstaclePool } from '../systems/ObstaclePool';
import { useGameStore } from '../systems/GameState';

function cloneForRender(segment, slotIndex, active) {
    if (!segment) {
        return {
            slotIndex,
            active: false,
            segment: null,
        };
    }

    return {
        slotIndex,
        active,
        segment,
    };
}

const TrackManager = forwardRef(function TrackManager({
    onBiomeChange,
    raftRef,
    forecastSamples = [],
    reachSegments = null,
    reachId = null,
    mapData = null,
    startIndex = 0,
    mapProgression = MEANDER_TO_WATERFALL_PROGRESSION,
}, ref) {
    const { camera, scene } = useThree();
    const [poolVersion, setPoolVersion] = useState(0);
    const [obstaclePoolVersion, setObstaclePoolVersion] = useState(0);
    const { isNight } = useNightMode();

    const chunkManagerRef = useRef(null);

    useImperativeHandle(ref, () => ({
        synthesizeSegmentEnter: (index) => {
            chunkManagerRef.current?.synthesizeSegmentEnter?.(index);
        },
        getLastEnteredSegment: () => chunkManagerRef.current?.getLastEnteredSegment?.() ?? -1,
    }));
    const forecastByIndexRef = useRef(new Map());
    const weatherWetnessRef = useRef(0);
    const mapManagerRef = useRef(
        mapData ? new JSONMapManager(mapData) : new DefaultMapManager({}, mapProgression)
    );
    const reachSegmentsRef = useRef(reachSegments);
    const obstaclePoolRef = useRef(createObstaclePool(16));

    // Keep reachSegments ref in sync
    useEffect(() => {
        reachSegmentsRef.current = reachSegments;
        if (chunkManagerRef.current && chunkManagerRef.current.isInitialized()) {
            chunkManagerRef.current.reset(reachSegments);
            chunkManagerRef.current.initializePool();
            setPoolVersion((v) => v + 1);
        }
    }, [reachSegments]);

    // Weather listener
    useEffect(() => {
        const onWeatherUpdate = (e) => {
            weatherWetnessRef.current = e.detail?.rippleStrength || 0;
        };
        window.addEventListener('weather-update', onWeatherUpdate);
        return () => window.removeEventListener('weather-update', onWeatherUpdate);
    }, []);

    // PBR texture loading
    const [colorMap, normalMap, roughnessMap, aoMap, displacementMap] = useTexture([
        './Rock031_1K-JPG_Color.jpg',
        './Rock031_1K-JPG_NormalGL.jpg',
        './Rock031_1K-JPG_Roughness.jpg',
        './Rock031_1K-JPG_AmbientOcclusion.jpg',
        './Rock031_1K-JPG_Displacement.jpg',
    ], () => {
        // Success
    }, (error) => {
        console.warn('[TrackManager] Texture loading failed, using fallback colors:', error);
    });

    // Fallback texture generator
    const fallbackTextures = useMemo(() => {
        const createFallbackTexture = (colorHex) => {
            const canvas = document.createElement('canvas');
            canvas.width = 2;
            canvas.height = 2;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = colorHex;
            ctx.fillRect(0, 0, 2, 2);
            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            return texture;
        };

        return {
            colorMap: createFallbackTexture('#8B7355'),
            normalMap: createFallbackTexture('#8080FF'),
            roughnessMap: createFallbackTexture('#D9D9D9'),
            aoMap: createFallbackTexture('#FFFFFF'),
            displacementMap: createFallbackTexture('#FFFFFF'),
        };
    }, []);

    useEffect(() => {
        const textures = [colorMap, normalMap, roughnessMap, aoMap, displacementMap];
        textures.forEach((texture) => {
            if (!texture) return;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(4, 8);
        });
    }, [colorMap, normalMap, roughnessMap, aoMap, displacementMap]);

    // Rock material
    const rockMaterial = useMemo(() => {
        let effectiveColorMap = colorMap || fallbackTextures.colorMap;
        let effectiveNormalMap = normalMap || fallbackTextures.normalMap;
        let effectiveRoughnessMap = roughnessMap || fallbackTextures.roughnessMap;
        let effectiveAoMap = aoMap || fallbackTextures.aoMap;
        let effectiveDisplacementMap = displacementMap || fallbackTextures.displacementMap;

        if (reachId) {
            const manifest = AssetCache.reaches.get(reachId);
            const rt = manifest?.requiredAssets?.rockTextures;
            if (rt) {
                const resolveTexture = (filename) => {
                    if (!filename) return null;
                    const url = filename.startsWith('http://') || filename.startsWith('https://') || filename.startsWith('/')
                        ? filename
                        : `${REACH_API_BASE}/${reachId}/assets/${filename}`;
                    return AssetCache.textures.get(url) || null;
                };
                effectiveColorMap = resolveTexture(rt.color) || effectiveColorMap;
                effectiveNormalMap = resolveTexture(rt.normal) || effectiveNormalMap;
                effectiveRoughnessMap = resolveTexture(rt.roughness) || effectiveRoughnessMap;
                effectiveAoMap = resolveTexture(rt.ao) || effectiveAoMap;
                effectiveDisplacementMap = resolveTexture(rt.displacement) || effectiveDisplacementMap;
            }
        }

        const hasRealTextures = !!(effectiveColorMap && effectiveNormalMap);

        if (!hasRealTextures) {
            console.log('[TrackManager] Using fallback textures for rock material');
        }

        const material = new THREE.MeshStandardMaterial({
            map: effectiveColorMap,
            normalMap: effectiveNormalMap,
            roughnessMap: effectiveRoughnessMap,
            aoMap: effectiveAoMap,
            roughness: 0.85,
            metalness: 0.05,
            vertexColors: true,
            side: THREE.DoubleSide,
            color: hasRealTextures ? new THREE.Color('#ffffff') : new THREE.Color('#8B7355'),
        });
        material.displacementMap = effectiveDisplacementMap;

        try {
            extendRiverMaterial(material, {
                waterLevel: WATER_LEVEL,
                enableMoss: false,
                enableTriplanar: false,
            });
        } catch (err) {
            console.warn('[TrackManager] Failed to extend river material:', err);
        }

        return material;
    }, [aoMap, colorMap, displacementMap, fallbackTextures, normalMap, reachId, roughnessMap]);

    // Forecast updates
    useEffect(() => {
        const nextForecastMap = new Map();
        forecastSamples.forEach((sample, index) => {
            nextForecastMap.set(index, sample.state);
        });
        forecastByIndexRef.current = nextForecastMap;

        if (chunkManagerRef.current && chunkManagerRef.current.isInitialized()) {
            chunkManagerRef.current.setForecastByIndex(nextForecastMap);
            setPoolVersion((v) => v + 1);
        }
    }, [forecastSamples]);

    // Initialize ChunkManager when material is ready
    useEffect(() => {
        if (!rockMaterial || chunkManagerRef.current?.isInitialized()) return;

        const callbacks = {
            onPoolChange: () => setPoolVersion((v) => v + 1),
            onBiomeChange: (biome, segmentIndex) => {
                onBiomeChange?.(biome, segmentIndex);
            },
            onSegmentEnter: (index) => {
                const activeSegments = chunkManagerRef.current?.getActiveSegments?.() ?? [];
                const entered = activeSegments.find((s) => s?.id === index);
                const flowSpeed = entered?.flowSpeed ?? 1.0;
                const gravityMultiplier = entered?.gravityMultiplier;
                // slipperiness is stored on the config, not the live SegmentData — read from map manager
                const segCfg = mapManagerRef.current?.getChunkConfig?.(index);
                const slipperiness = segCfg?.slipperiness ?? 0;
                window.__watershedFlowSpeed = flowSpeed;
                window.__watershedSlipperiness = slipperiness;
                window.dispatchEvent(new CustomEvent('segment-enter', { detail: { segmentIndex: index, flowSpeed, gravityMultiplier, slipperiness } }));

                const segmentConfig = mapManagerRef.current?.getChunkConfig?.(index);
                if (segmentConfig?.journeyComplete && !useGameStore.getState().isJourneyComplete) {
                    useGameStore.getState().setJourneyComplete();
                }
            },
        };

        chunkManagerRef.current = new ChunkManager({
            mapManager: mapManagerRef.current,
            reachSegments: reachSegmentsRef.current,
            forecastByIndex: forecastByIndexRef.current,
            callbacks,
            startIndex,
        });

        chunkManagerRef.current.initializePool();
        setPoolVersion((v) => v + 1);

        return () => {
            chunkManagerRef.current?.dispose?.();
            chunkManagerRef.current = null;
        };
    }, [rockMaterial, onBiomeChange, reachSegments]);

    // Night mode: update scene fog and background
    useEffect(() => {
        if (!scene) return;

        const skyColor = isNight ? '#0a1428' : '#87ceeb';
        const fogColor = isNight ? '#1a2a4a' : '#a5d6ff';
        const fogNear = isNight ? 10 : 20;
        const fogFar = isNight ? 100 : 150;

        scene.background = new THREE.Color(skyColor);
        scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

        console.log(`[TrackManager] ${isNight ? '🌙 Night' : '☀️ Day'} mode activated`);
    }, [isNight, scene]);

    // Per-frame update: delegate generation and recycling to ChunkManager
    useFrame(() => {
        if (!chunkManagerRef.current?.isInitialized()) return;

        const { x, y, z } = camera.position;
        const cameraSane =
          Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) &&
          y >= -80 && y <= 250 && Math.abs(x) <= 6000 && Math.abs(z) <= 6000;
        if (!cameraSane) return;

        const result = chunkManagerRef.current.update(camera.position.z);

        if (result.poolChanged) {
            setPoolVersion((v) => v + 1);
        }
    });

    const renderedSlots = useMemo(() => {
        if (!chunkManagerRef.current?.isInitialized()) {
            return [];
        }
        return chunkManagerRef.current.getRenderedSlots().map((slot) =>
            cloneForRender(slot.segment, slot.slotIndex, slot.active)
        );
    }, [poolVersion]);

    const activeSegments = useMemo(() => {
        if (!chunkManagerRef.current?.isInitialized()) {
            return [];
        }
        return chunkManagerRef.current.getActiveSegments();
    }, [poolVersion]);

    useEffect(() => {
        obstaclePoolRef.current.syncSegments(activeSegments);
        setObstaclePoolVersion((v) => v + 1);
    }, [activeSegments]);

    const pooledObstacleSlots = useMemo(
        () => obstaclePoolRef.current.getSnapshot(),
        [obstaclePoolVersion]
    );

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.__watershedObstaclePool = {
            size: pooledObstacleSlots.length,
            active: pooledObstacleSlots.filter((slot) => slot.active).length,
            types: pooledObstacleSlots.reduce((acc, slot) => {
                if (slot.active) acc[slot.type] = (acc[slot.type] || 0) + 1;
                return acc;
            }, {}),
        };
    }, [pooledObstacleSlots]);

    return (
        <group name="track-manager">
            {renderedSlots.map(({ slotIndex, active, segment }) => (
                <TrackSegment
                    key={slotIndex}
                    active={active}
                    segmentId={segment?.id}
                    rockMaterial={rockMaterial}
                    rockNormalMap={normalMap}
                    raftRef={raftRef}
                    segmentPath={segment?.segmentPath}
                    segmentState={segment?.segmentState || 'Normal'}
                    waterWidth={segment?.waterWidth}
                    biome={segment?.biome || 'summer'}
                    isNight={isNight}
                    weatherWetnessRef={weatherWetnessRef}
                    usePooledStaticObstacles
                    {...(segment || {})}
                />
            ))}

            <PooledObstacles slots={pooledObstacleSlots} rockMaterial={rockMaterial} />
            <WaterFlowForces targetRef={raftRef} segments={activeSegments} reachId={reachId} />
            <VehicleTuner targetRef={raftRef} segments={activeSegments} />
        </group>
    );
});

export default TrackManager;
