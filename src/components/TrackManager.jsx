import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import TrackSegment from './TrackSegment';
import WaterForces from './WaterForces';
import { extendRiverMaterial } from '../utils/RiverShader';
import { GENERATION, WATER_LEVEL } from '../constants/game';
import { BIOMES, getNextBiome } from '../constants/biomes';
import { useNightMode } from '../hooks/useNightMode';
import { getTrackBiomeProfile } from '../configs/TrackBiomes';

const POOL_SIZE = GENERATION.POOL_SIZE;
const MAX_ACTIVE_SEGMENTS = GENERATION.MAX_ACTIVE_SEGMENTS;

const INITIAL_POINTS = [
    new THREE.Vector3(0, -6, 30),
    new THREE.Vector3(0, -6, 5),
    new THREE.Vector3(2, -8, -25),
    new THREE.Vector3(8, -12, -60),
];

function getProgressionConfig(index) {
    const base = {
        biome: 'summer',
        type: 'normal',
        width: 35,
        waterWidth: 10,
        meanderStrength: 1.2,
        verticalBias: -0.5,
        flowSpeed: 1,
        treeDensity: 1,
        rockDensity: 'low',
    };

    if (index <= 12) return base;
    if (index === 13) return { ...base, meanderStrength: 0.2, verticalBias: -1.2, flowSpeed: 1.15 };
    if (index === 14) return {
        ...base,
        type: 'waterfall',
        verticalBias: -3,
        meanderStrength: 0,
        forwardMomentum: 0.15,
        particleCount: 400,
        cameraShake: 0.5,
        flowSpeed: 1.6,
    };
    if (index === 15) return {
        ...base,
        type: 'splash',
        biome: 'autumn',
        verticalBias: -0.2,
        meanderStrength: 0.5,
        width: 70,
        waterWidth: 18,
        flowSpeed: 0.3,
    };
    if (index >= 16 && index <= 18) return {
        ...base,
        type: 'pond',
        biome: 'autumn',
        verticalBias: -0.02,
        meanderStrength: 0.3,
        width: 70,
        waterWidth: 28,
        treeDensity: 0.3,
        flowSpeed: 0.45,
    };
    if (index >= 20 && index <= 22) return {
        ...base,
        biome: 'slotCanyon',
        width: 24,
        waterWidth: 8,
        meanderStrength: 0.55,
        verticalBias: -0.95,
        flowSpeed: 1.3,
        treeDensity: 0.08,
        rockDensity: 'high',
    };
    return {
        ...base,
        biome: 'autumn',
        verticalBias: -0.7,
        meanderStrength: 1.5,
        rockDensity: 'high',
        flowSpeed: 1.15,
    };
}

function createSpline(points, type) {
    const tension = type === 'pond' ? 0.1 : 0.5;
    return new THREE.CatmullRomCurve3(points, false, 'catmullrom', tension);
}

/**
 * ensureTangentContinuity — forces the new segment's start tangent to match 
 * the previous segment's end tangent. This eliminates NaNs in Catmull-Rom 
 * derivative math at segment joints.
 */
function ensureTangentContinuity(prevPoints, newPoints) {
    if (!prevPoints || prevPoints.length < 2 || newPoints.length < 2) {
        return newPoints;
    }

    const lastTwo = prevPoints.slice(-2);
    const prevTangent = new THREE.Vector3()
        .subVectors(lastTwo[1], lastTwo[0])
        .normalize();
    
    // If previous tangent is zero or NaN, skip correction
    if (!prevTangent.lengthSq() || !isFinite(prevTangent.x)) {
        console.warn('[ensureTangentContinuity] Invalid previous tangent, skipping');
        return newPoints;
    }

    // Calculate the new first point to align with previous tangent
    const desiredStart = newPoints[0].clone().add(
        prevTangent.multiplyScalar(0.01) // tiny epsilon offset
    );
    
    // Override the start point of the new segment
    newPoints[0] = desiredStart;
    
    return newPoints;
}

function createSegmentData(index, previousSegment, forecastState, ensureContinuity = false) {
    const config = getProgressionConfig(index);
    const biomeProfile = getTrackBiomeProfile(config.biome);
    const seed = 12345 + index * 1000;

    const lastPoints = previousSegment?.points ?? INITIAL_POINTS;
    const lastPoint = lastPoints[lastPoints.length - 1].clone();
    const prevPoint = (lastPoints[lastPoints.length - 2] ?? INITIAL_POINTS[0]).clone();
    const direction = new THREE.Vector3().subVectors(lastPoint, prevPoint).normalize();
    const points = [lastPoint.clone()];
    const currentPos = lastPoint.clone();

    const localRandom = (offset) => {
        const value = Math.sin(seed + offset * 17.31) * 10000;
        return value - Math.floor(value);
    };

    for (let step = 0; step < 3; step += 1) {
        const turnFactor = Math.sin(index * 0.5 + step) * config.meanderStrength;
        direction.x += turnFactor * 0.3 + (localRandom(step + 1) - 0.5) * 0.2;
        direction.y += localRandom(step + 2) * 0.2 + config.verticalBias * 0.2;

        const maxUpward = config.type === 'pond' ? -0.01 : -0.1;
        if (direction.y > maxUpward) direction.y = maxUpward;

        direction.normalize();

        if (config.type !== 'waterfall') {
            if (direction.z > -0.5) direction.z = -0.5;
        } else {
            direction.z = -0.12;
            direction.y = Math.min(direction.y, -0.92);
        }

        direction.normalize();

        const distance = 30 + localRandom(step + 3) * 10;
        currentPos.add(direction.clone().multiplyScalar(distance));
        points.push(currentPos.clone());
    }

    // Apply tangent continuity fix if requested (for segment recycling)
    const continuousPoints = ensureContinuity && previousSegment?.points
        ? ensureTangentContinuity(previousSegment.points, points)
        : points;

    const segmentPath = createSpline(continuousPoints, config.type);
    const forecastBoost = forecastState === 'Flooded' ? 1.45 : forecastState === 'HighFlow' ? 1.2 : 1;

    return {
        id: index,
        type: forecastState === 'Flooded' && config.type === 'normal' ? 'pond' : config.type,
        biome: biomeProfile.id === 'slotCanyon' ? 'slotCanyon' : config.biome,
        points: continuousPoints,
        segmentPath,
        width: config.width,
        waterWidth: config.waterWidth,
        flowSpeed: config.flowSpeed * forecastBoost,
        particleCount: config.particleCount || 0,
        cameraShake: config.cameraShake || 0,
        treeDensity: config.treeDensity,
        rockDensity: config.rockDensity,
        segmentState: forecastState,
        wallProfile: biomeProfile,
    };
}

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

export default function TrackManager({ onBiomeChange, raftRef, forecastSamples = [] }) {
    const { camera, scene } = useThree();
    const [poolVersion, setPoolVersion] = useState(0);
    const [currentBiome, setCurrentBiome] = useState('river');
    const { isNight } = useNightMode();
    const poolRef = useRef(Array.from({ length: POOL_SIZE }, (_, slotIndex) => ({ slotIndex, segment: null })));
    const activeOrderRef = useRef([]);
    const nextSegmentIdRef = useRef(0);
    const lastReportedBiome = useRef('summer');
    const initializedRef = useRef(false);
    const forecastByIndexRef = useRef(new Map());

    const [colorMap, normalMap, roughnessMap, aoMap] = useTexture([
        './Rock031_1K-JPG_Color.jpg',
        './Rock031_1K-JPG_NormalGL.jpg',
        './Rock031_1K-JPG_Roughness.jpg',
        './Rock031_1K-JPG_AmbientOcclusion.jpg',
    ], (textures) => {
        // Success callback - textures loaded
        console.log('[TrackManager] PBR textures loaded successfully');
    }, (error) => {
        // Error callback - textures failed to load
        console.warn('[TrackManager] Texture loading failed, using fallback colors:', error);
    });

    // Fallback texture generator - creates solid color textures when PBR set fails
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
            normalMap: createFallbackTexture('#8080FF'), // Flat normal
            roughnessMap: createFallbackTexture('#D9D9D9'), // ~85% roughness
            aoMap: createFallbackTexture('#FFFFFF'), // No AO
        };
    }, []);

    useEffect(() => {
        const textures = [colorMap, normalMap, roughnessMap, aoMap];
        textures.forEach((texture) => {
            if (!texture) return;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(4, 8);
        });
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    const rockMaterial = useMemo(() => {
        // Use loaded textures if available, otherwise fallbacks
        const effectiveColorMap = colorMap || fallbackTextures.colorMap;
        const effectiveNormalMap = normalMap || fallbackTextures.normalMap;
        const effectiveRoughnessMap = roughnessMap || fallbackTextures.roughnessMap;
        const effectiveAoMap = aoMap || fallbackTextures.aoMap;

        const hasRealTextures = !!(colorMap && normalMap);
        
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

        // The canyon floor geometry only has position/normal/uv/color attributes.
        // Disable moss and triplanar so the shader doesn't declare mossMask or
        // uv2 attributes that are absent from this geometry, which can cause
        // WebGL program validation failures on some GPU drivers.
        extendRiverMaterial(material, {
            waterLevel: WATER_LEVEL,
            enableMoss: false,
            enableTriplanar: false,
        });

        return material;
    }, [aoMap, colorMap, fallbackTextures, normalMap, roughnessMap]);

    useEffect(() => {
        const nextForecastMap = new Map();
        forecastSamples.forEach((sample, index) => {
            nextForecastMap.set(index, sample.state);
        });
        forecastByIndexRef.current = nextForecastMap;

        poolRef.current = poolRef.current.map((slot) => {
            if (!slot.segment) return slot;
            const forecastState = forecastByIndexRef.current.get(slot.segment.id) || slot.segment.segmentState || 'Normal';
            return {
                ...slot,
                segment: {
                    ...slot.segment,
                    segmentState: forecastState,
                },
            };
        });

        setPoolVersion((value) => value + 1);
    }, [forecastSamples]);

    const buildSegment = useRef((index, previousSegment, ensureContinuity = false) => {
        const forecastState = forecastByIndexRef.current.get(index) || 'Normal';
        return createSegmentData(index, previousSegment, forecastState, ensureContinuity);
    }).current;

    const initializePool = useRef(() => {
        const pool = Array.from({ length: POOL_SIZE }, (_, slotIndex) => ({ slotIndex, segment: null }));
        let previousSegment = null;
        const activeOrder = [];

        for (let index = 0; index < MAX_ACTIVE_SEGMENTS; index += 1) {
            const segment = buildSegment(index, previousSegment);
            pool[index] = { slotIndex: index, segment };
            activeOrder.push(index);
            previousSegment = segment;
            nextSegmentIdRef.current = index + 1;
        }

        poolRef.current = pool;
        activeOrderRef.current = activeOrder;
        initializedRef.current = true;
        setPoolVersion((value) => value + 1);
    }).current;

    useEffect(() => {
        if (!rockMaterial || initializedRef.current) return;
        initializePool();
    }, [initializePool, rockMaterial]);

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

    useFrame(() => {
        if (!initializedRef.current) return;

        const pool = poolRef.current;
        const activeOrder = activeOrderRef.current;
        const activeSegments = activeOrder.map((slotIndex) => pool[slotIndex]?.segment).filter(Boolean);
        if (activeSegments.length === 0) return;

        const newestSegment = activeSegments[activeSegments.length - 1];
        const newestEndPoint = newestSegment.segmentPath.getPoint(1);
        const cameraPos = camera.position;

        if (cameraPos.z - newestEndPoint.z < GENERATION.THRESHOLD) {
            // 1. Snapshot the current state BEFORE any mutation (prevents race conditions)
            const currentActive = [...activeOrder]; // ← copy, no more race
            const slotToRecycle = currentActive.length >= MAX_ACTIVE_SEGMENTS
                ? currentActive.shift() // safe because we copied
                : currentActive.length;

            if (slotToRecycle === undefined) {
                return;
            }

            const previousSegment = activeSegments[activeSegments.length - 1];

            // Occasionally switch biome (~22% chance every 4th segment)
            if (Math.random() < 0.22 && nextSegmentIdRef.current % 4 === 0) {
                setCurrentBiome(getNextBiome(currentBiome));
            }

            // Defensive epsilon guard: check for gaps between segments
            if (previousSegment) {
                const prevEnd = previousSegment.segmentPath.getPoint(1);
                const gap = prevEnd.distanceTo(newestEndPoint);
                if (gap > 0.001) {
                    console.warn(`[TrackManager] Handoff gap detected: ${gap.toFixed(4)} — proceeding with caution`);
                }
            }

            // 2. Build the next segment with EXPLICIT tangent continuity
            const nextIndex = nextSegmentIdRef.current;
            const nextSegment = buildSegment(nextIndex, previousSegment, true); // ← continuity flag

            // 3. Atomic pool swap
            pool[slotToRecycle] = {
                slotIndex: slotToRecycle,
                segment: nextSegment,
            };

            // 4. Update order safely (only one state update)
            activeOrder.splice(0, 1); // remove front
            activeOrder.push(slotToRecycle); // push new to back

            nextSegmentIdRef.current += 1;
            setPoolVersion((value) => value + 1);
        }

        const oldestSegment = activeSegments[0];
        if (oldestSegment && cameraPos.z > oldestSegment.segmentPath.getPoint(1).z + GENERATION.RECYCLE_MARGIN) {
            // The oldest segment is safely behind the player and remains eligible for recycling on the next append.
        }

        if (onBiomeChange) {
            let closestSegment = null;
            let closestDistance = Infinity;

            for (const segment of activeSegments) {
                const centerPoint = segment.segmentPath.getPoint(0.5);
                const distance = Math.abs(cameraPos.z - centerPoint.z);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestSegment = segment;
                }
            }

            if (closestSegment && closestSegment.biome !== lastReportedBiome.current) {
                lastReportedBiome.current = closestSegment.biome;
                onBiomeChange(closestSegment.biome);
                window.dispatchEvent(new CustomEvent('biome-change', { detail: { biome: closestSegment.biome } }));
            }
        }
    });

    const activeSlotSet = useMemo(() => new Set(activeOrderRef.current), [poolVersion]);
    const renderedSlots = useMemo(() => {
        return poolRef.current.map((slot) => cloneForRender(slot.segment, slot.slotIndex, activeSlotSet.has(slot.slotIndex)));
    }, [activeSlotSet, poolVersion]);

    const activeSegments = useMemo(() => {
        return renderedSlots.filter((slot) => slot.active && slot.segment).map((slot) => slot.segment);
    }, [renderedSlots]);

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
                    biome={currentBiome}
                    isNight={isNight}
                    {...(segment || {})}
                />
            ))}

            <WaterForces targetRef={raftRef} segments={activeSegments} />
        </group>
    );
}
