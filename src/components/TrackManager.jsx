import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import TrackSegment from './TrackSegment';
import WaterFlowForces from './WaterFlowForces';
import VehicleTuner from './VehicleTuner';
import { extendRiverMaterial } from '../utils/RiverShader';
import { WATER_LEVEL, REACH_API_BASE } from '../constants/game';
import { AssetCache } from '../systems/ReachStreamer';
import { useNightMode } from '../hooks/useNightMode';
import { DefaultMapManager, JSONMapManager } from '../systems/MapSystem';
import { MEANDER_TO_WATERFALL_PROGRESSION } from '../maps/meander_to_waterfall';
import { ChunkManager } from '../systems/ChunkManager';

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

export default function TrackManager({ onBiomeChange, raftRef, forecastSamples = [], reachSegments = null, reachId = null, mapData = null }) {
    const { camera, scene } = useThree();
    const [poolVersion, setPoolVersion] = useState(0);
    const { isNight } = useNightMode();

    const chunkManagerRef = useRef(null);
    const forecastByIndexRef = useRef(new Map());
    const weatherWetnessRef = useRef(0);
    const mapManagerRef = useRef(
        mapData ? new JSONMapManager(mapData) : new DefaultMapManager({}, MEANDER_TO_WATERFALL_PROGRESSION)
    );
    const reachSegmentsRef = useRef(reachSegments);

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
                window.__watershedFlowSpeed = flowSpeed;
                window.dispatchEvent(new CustomEvent('segment-enter', { detail: { segmentIndex: index, flowSpeed } }));
            },
        };

        chunkManagerRef.current = new ChunkManager({
            mapManager: mapManagerRef.current,
            reachSegments: reachSegmentsRef.current,
            forecastByIndex: forecastByIndexRef.current,
            callbacks,
        });

        chunkManagerRef.current.initializePool();
        setPoolVersion((v) => v + 1);
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

    return (
        <group name="track-manager">
            {renderedSlots.map(({ slotIndex, active, segment }) => (
                <TrackSegment
                    key={slotIndex}
                    active={active}
                    rockMaterial={rockMaterial}
                    rockNormalMap={normalMap}
                    raftRef={raftRef}
                    segmentPath={segment?.segmentPath}
                    segmentState={segment?.segmentState || 'Normal'}
                    waterWidth={segment?.waterWidth}
                    biome={segment?.biome || 'summer'}
                    isNight={isNight}
                    weatherWetnessRef={weatherWetnessRef}
                    {...(segment || {})}
                />
            ))}

            <WaterFlowForces targetRef={raftRef} segments={activeSegments} reachId={reachId} />
            <VehicleTuner targetRef={raftRef} segments={activeSegments} />
        </group>
    );
}
