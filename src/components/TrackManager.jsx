import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { extendRiverMaterial } from '../utils/RiverShader';
import TrackSegment from './TrackSegment';

const GENERATION_THRESHOLD = 150;
const MAX_ACTIVE_SEGMENTS = 7;
const POOL_SIZE = 10;

/**
 * Default segment configuration (fallback when no level data provided)
 */
const getSegmentConfig = (id) => {
    const base = {
        type: 'normal',
        biome: 'summer',
        width: 35,
        meanderStrength: 1.2,
        verticalBias: -0.5,
        segmentLengthMult: 1.0,
        particleCount: 0,
        cameraShake: 0,
        forwardMomentum: 1.0,
        transitionDuration: 0,
        flowSpeed: 1.0,
        fogDensity: 0,
        treeDensity: 1.0,
        rockDensity: 'low'
    };

    if (id <= 12) { // Phase 1: The Meander
        return base;
    }
    if (id === 13) { // Approach
        return { ...base, meanderStrength: 0.2, verticalBias: -1.2 };
    }
    if (id === 14) { // THE WATERFALL
        return {
            ...base,
            type: 'waterfall',
            biome: 'summer',
            verticalBias: -3.0,
            meanderStrength: 0.0,
            segmentLengthMult: 0.5,
            forwardMomentum: 0.15,
            particleCount: 400,
            cameraShake: 0.5
        };
    }
    if (id === 15) { // Splash Pool (Biome Transition)
        return {
            ...base,
            type: 'splash',
            biome: 'autumn',
            verticalBias: -0.2,
            meanderStrength: 0.5,
            transitionDuration: 2000,
            width: 70,
            flowSpeed: 0.3
        };
    }
    if (id >= 16 && id <= 18) { // The Pond
        return {
            ...base,
            type: 'pond',
            biome: 'autumn',
            verticalBias: -0.02,
            meanderStrength: 0.3,
            segmentLengthMult: 1.2,
            width: 70,
            fogDensity: 0.8,
            treeDensity: 0.3
        };
    }
    if (id >= 19) { // Autumn Rapids
        return {
            ...base,
            type: 'normal',
            biome: 'autumn',
            verticalBias: -0.7,
            meanderStrength: 1.5,
            width: 35,
            rockDensity: 'high'
        };
    }
    return base; // Fallback
};

const INITIAL_SEGMENTS = [
    {
        id: 0,
        type: 'normal',
        biome: 'summer',
        points: [
            new THREE.Vector3(0, -6, 30),
            new THREE.Vector3(0, -6, 5),
            new THREE.Vector3(2, -8, -25),
            new THREE.Vector3(8, -12, -60),
        ],
    },
    {
        id: 1,
        type: 'normal',
        biome: 'summer',
        points: [
            new THREE.Vector3(8, -12, -60),
            new THREE.Vector3(12, -15, -100),
            new THREE.Vector3(5, -18, -140),
            new THREE.Vector3(-5, -22, -180),
        ],
    },
];

/**
 * Convert level state segment config to TrackManager format
 */
function convertLevelSegmentToTrackSegment(segmentConfig, index, totalSegments, curve) {
    // Calculate points along the curve for this segment
    const tStart = index / totalSegments;
    const tEnd = (index + 1) / totalSegments;
    
    const points = [];
    const numPoints = 4;
    for (let i = 0; i < numPoints; i++) {
        const t = tStart + (tEnd - tStart) * (i / (numPoints - 1));
        points.push(curve.getPoint(Math.min(1, t)));
    }

    // Map biome type
    const biomeMap = {
        'creek-summer': 'summer',
        'creek-autumn': 'autumn',
        'alpine-spring': 'summer',
        'canyon-sunset': 'autumn',
        'midnight-mist': 'autumn',
    };

    return {
        id: index,
        type: segmentConfig.type || 'normal',
        biome: biomeMap[segmentConfig.biomeOverride] || biomeMap['creek-summer'] || 'summer',
        points,
        // Pass through all config for TrackSegment to use
        width: segmentConfig.width,
        flowSpeed: segmentConfig.physics?.waterFlowIntensity || 1.0,
        particleCount: segmentConfig.effects?.particleCount || 0,
        cameraShake: segmentConfig.effects?.cameraShake || 0,
        treeDensity: segmentConfig.decorations?.trees ? segmentConfig.decorations.trees / 20 : 1.0,
        rockDensity: segmentConfig.difficulty > 0.6 ? 'high' : 'low',
        // Store full config for advanced usage
        levelConfig: segmentConfig,
    };
}

/**
 * TrackManager Component
 * 
 * Manages procedural track generation and segment lifecycle.
 * Now supports loading from LevelLoader levelState.
 * 
 * Props:
 * - onBiomeChange: Callback when player enters different biome
 * - raftRef: Reference to player raft for position tracking
 * - levelState: Optional level data from LevelLoader (enables custom maps)
 */
export default function TrackManager({ onBiomeChange, raftRef, levelState }) {
    // Determine if we're using level data or fallback to defaults
    const useLevelData = levelState != null;
    
    // Initialize segments based on mode
    const initialSegments = useMemo(() => {
        if (useLevelData && levelState.initialSegments) {
            return levelState.initialSegments;
        }
        return INITIAL_SEGMENTS;
    }, [useLevelData, levelState]);

    const [segments, setSegments] = useState(initialSegments);
    const segmentsRef = useRef(initialSegments);
    const lastSegmentId = useRef(useLevelData ? initialSegments.length - 1 : 1);
    const lastGeneratedFromId = useRef(-1);
    const { camera } = useThree();

    // Track global meandering phase
    const meanderPhase = useRef(0);

    // Track current biome to avoid unnecessary state updates
    const lastReportedBiome = useRef('summer');

    // Store level state for generation
    const levelStateRef = useRef(levelState);
    
    useEffect(() => {
        segmentsRef.current = segments;
    }, [segments]);

    useEffect(() => {
        levelStateRef.current = levelState;
    }, [levelState]);

    // --- SHARED MATERIAL ASSETS ---
    const [colorMap, normalMap, roughnessMap, aoMap] = useTexture([
        './Rock031_1K-JPG_Color.jpg',
        './Rock031_1K-JPG_NormalGL.jpg',
        './Rock031_1K-JPG_Roughness.jpg',
        './Rock031_1K-JPG_AmbientOcclusion.jpg',
    ]);

    // Configure texture wrapping once loaded
    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap].forEach(texture => {
            if (texture) {
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.set(4, 8);
            }
        });
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    // Create the Wet Rock Material (Shared) using PBR textures
    const rockMaterial = useMemo(() => {
        if (!colorMap || !normalMap) {
            return new THREE.MeshStandardMaterial({
                color: new THREE.Color(0.4, 0.35, 0.3),
                roughness: 0.9,
                metalness: 0,
                vertexColors: true,
                side: THREE.DoubleSide,
            });
        }
        return new THREE.MeshStandardMaterial({
            map: colorMap,
            normalMap: normalMap,
            roughnessMap: roughnessMap || undefined,
            aoMap: aoMap || undefined,
            roughness: 0.85,
            metalness: 0.05,
            vertexColors: true,
            side: THREE.DoubleSide,
        });
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    /**
     * Generate next segment based on mode (level data or procedural)
     */
    const generateNextSegment = useCallback((lastSegment) => {
        // If using level data, generate from level configuration
        if (useLevelData && levelStateRef.current) {
            const nextId = lastSegment.id + 1;
            const { segments: segmentConfigs, track } = levelStateRef.current;
            
            // Check if we've exceeded the defined segments
            if (nextId >= track.totalSegments) {
                // Loop back or stop generating
                return null;
            }
            
            // Find segment config
            const segmentConfig = segmentConfigs.find(s => s.index === nextId);
            if (segmentConfig) {
                const converted = convertLevelSegmentToTrackSegment(
                    segmentConfig,
                    nextId,
                    track.totalSegments,
                    levelStateRef.current.curve
                );
                lastSegmentId.current = nextId;
                return converted;
            }
        }
        
        // Fallback to procedural generation
        const lastPoints = lastSegment.points;
        const lastPoint = lastPoints[lastPoints.length - 1];
        const prevPoint = lastPoints[lastPoints.length - 2];
        const currentId = lastSegmentId.current + 1;

        // --- LEVEL DIRECTOR ---
        const config = getSegmentConfig(currentId);

        // --- GENERATION MATH ---
        const direction = new THREE.Vector3().subVectors(lastPoint, prevPoint).normalize();
        const newPoints = [lastPoint.clone()];
        let currentPos = lastPoint.clone();

        for (let i = 0; i < 3; i++) {
            meanderPhase.current += 0.5;
            const turnFactor = Math.sin(meanderPhase.current) * config.meanderStrength;

            direction.x += turnFactor * 0.3;
            direction.x += (Math.random() - 0.5) * 0.2;
            direction.y += (Math.random() * 0.2 + config.verticalBias * 0.2);

            const maxUpward = config.type === 'pond' ? -0.01 : -0.1;
            if (direction.y > maxUpward) direction.y = maxUpward;

            direction.normalize();
            if (config.type !== 'waterfall') {
                if (direction.z > -0.5) direction.z = -0.5;
            } else {
                direction.z = -0.1;
            }
            direction.normalize();

            const baseDist = 30 + Math.random() * 10;
            const dist = baseDist * config.segmentLengthMult;

            const step = direction.clone().multiplyScalar(dist);
            currentPos.add(step);
            newPoints.push(currentPos.clone());
        }

        lastSegmentId.current = currentId;

        return {
            id: currentId,
            points: newPoints,
            ...config,
        };
    }, [useLevelData]);

    useFrame((state) => {
        // Update Rock Material Time
        if (rockMaterial.userData.shader) {
            rockMaterial.userData.shader.uniforms.time.value = state.clock.elapsedTime;
        }

        const currentSegments = segmentsRef.current;
        if (currentSegments.length === 0) return;

        // 1. GENERATION LOGIC
        const lastSegment = currentSegments[currentSegments.length - 1];
        
        // Check if we should stop generating (level data mode)
        if (useLevelData && levelStateRef.current) {
            if (lastSegment.id >= levelStateRef.current.track.totalSegments - 1) {
                // Don't generate beyond defined level
            }
        }
        
        if (lastSegment.id !== lastGeneratedFromId.current) {
            const lastPoint = lastSegment.points[lastSegment.points.length - 1];
            if (camera.position.z - lastPoint.z < GENERATION_THRESHOLD) {
                lastGeneratedFromId.current = lastSegment.id;
                const newSegment = generateNextSegment(lastSegment);
                
                // Don't add null segments (end of level data)
                if (!newSegment) return;

                setSegments(prev => {
                    const updated = [...prev, newSegment];
                    if (updated.length > MAX_ACTIVE_SEGMENTS) {
                        return updated.slice(updated.length - MAX_ACTIVE_SEGMENTS);
                    }
                    return updated;
                });
            }
        }

        // 2. BIOME DETECTION (Closest Segment)
        if (onBiomeChange) {
            let closestSegment = null;
            let minDistance = Infinity;
            const camZ = camera.position.z;

            // Simple heuristic: check which segment center is closest to camera Z
            for (const seg of currentSegments) {
                if (!seg.points || seg.points.length === 0) continue;

                const startZ = seg.points[0].z;
                const endZ = seg.points[seg.points.length - 1].z;
                const centerZ = (startZ + endZ) / 2;

                const dist = Math.abs(camZ - centerZ);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestSegment = seg;
                }
            }

            if (closestSegment && closestSegment.biome !== lastReportedBiome.current) {
                lastReportedBiome.current = closestSegment.biome;
                onBiomeChange(closestSegment.biome);
            }
        }
    });

    return (
        <group name="track-manager">
            {Array.from({ length: POOL_SIZE }).map((_, index) => {
                const segment = segments.find(s => (s.id % POOL_SIZE) === index);
                return (
                    <TrackSegment
                        key={index}
                        active={!!segment}
                        rockMaterial={rockMaterial}
                        rockNormalMap={normalMap}
                        raftRef={raftRef}
                        {...segment}
                    />
                );
            })}
        </group>
    );
}
