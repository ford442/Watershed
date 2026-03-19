import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import TrackSegment from './TrackSegment';
import WaterForces from './WaterForces';
import { extendRiverMaterial } from '../utils/RiverShader';
import { GENERATION, WATER_LEVEL } from '../constants/game';
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

function createSegmentData(index, previousSegment, forecastState) {
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

    const segmentPath = createSpline(points, config.type);
    const forecastBoost = forecastState === 'Flooded' ? 1.45 : forecastState === 'HighFlow' ? 1.2 : 1;

    return {
        id: index,
        type: forecastState === 'Flooded' && config.type === 'normal' ? 'pond' : config.type,
        biome: biomeProfile.id === 'slotCanyon' ? 'slotCanyon' : config.biome,
        points,
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
    const { camera } = useThree();
    const [poolVersion, setPoolVersion] = useState(0);
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
    ]);

    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap].forEach((texture) => {
            if (!texture) return;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(4, 8);
        });
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    const rockMaterial = useMemo(() => {
        const material = new THREE.MeshStandardMaterial({
            map: colorMap || undefined,
            normalMap: normalMap || undefined,
            roughnessMap: roughnessMap || undefined,
            aoMap: aoMap || undefined,
            roughness: 0.85,
            metalness: 0.05,
            vertexColors: true,
            side: THREE.DoubleSide,
            color: colorMap ? new THREE.Color('#ffffff') : new THREE.Color('#4a4038'),
        });

        extendRiverMaterial(material, {
            waterLevel: WATER_LEVEL,
        });

        return material;
    }, [aoMap, colorMap, normalMap, roughnessMap]);

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

    const buildSegment = useRef((index, previousSegment) => {
        const forecastState = forecastByIndexRef.current.get(index) || 'Normal';
        return createSegmentData(index, previousSegment, forecastState);
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
            const slotToRecycle = activeOrder.length >= MAX_ACTIVE_SEGMENTS ? activeOrder.shift() : activeOrder.length;
            const previousSegment = activeSegments[activeSegments.length - 1];
            const nextIndex = nextSegmentIdRef.current;
            const nextSegment = buildSegment(nextIndex, previousSegment);

            if (slotToRecycle === undefined) {
                return;
            }

            pool[slotToRecycle] = {
                slotIndex: slotToRecycle,
                segment: nextSegment,
            };
            activeOrder.push(slotToRecycle);
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
                    {...(segment || {})}
                />
            ))}

            <WaterForces targetRef={raftRef} segments={activeSegments} />
        </group>
    );
}
