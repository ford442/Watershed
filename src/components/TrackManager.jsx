import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { extendRiverMaterial } from '../utils/RiverShader';
import TrackSegment from './TrackSegment';

const GENERATION_THRESHOLD = 150;
const MAX_ACTIVE_SEGMENTS = 7;
const POOL_SIZE = 10;

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

export default function TrackManager({ onBiomeChange, raftRef }) {
    console.log('[TrackManager] Rendering...');
    const [segments, setSegments] = useState(INITIAL_SEGMENTS);
    const segmentsRef = useRef(INITIAL_SEGMENTS);
    const lastSegmentId = useRef(1);
    const lastGeneratedFromId = useRef(-1);
    const { camera } = useThree();

    // Track global meandering phase
    const meanderPhase = useRef(0);

    // Track current biome to avoid unnecessary state updates
    const lastReportedBiome = useRef('summer');

    useEffect(() => {
        segmentsRef.current = segments;
    }, [segments]);

    // --- SHARED MATERIAL ASSETS ---
    // UPDATED: Use relative paths for static hosting compatibility
    console.log('[TrackManager] Loading textures...');
    const [colorMap, normalMap, roughnessMap, aoMap] = useTexture([
        './Rock031_1K-JPG_Color.jpg', // NOTE: Relative path for static hosting compatibility. Keep FTP structure in mind.
        './Rock031_1K-JPG_NormalGL.jpg',
        './Rock031_1K-JPG_Roughness.jpg',
        './Rock031_1K-JPG_AmbientOcclusion.jpg',
    ]);
    console.log('[TrackManager] Textures loaded:', { colorMap: !!colorMap, normalMap: !!normalMap, roughnessMap: !!roughnessMap, aoMap: !!aoMap });

    // Configure texture wrapping once loaded
    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap].forEach(texture => {
            if (texture) {
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.set(4, 8);
            }
        });
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    // Create the custom Wet Rock Material (Shared)
    // TEMP: Simplified to meshBasicMaterial to avoid shader errors
    const rockMaterial = useMemo(() => {
        console.log('[TrackManager] Creating SIMPLE rock material...');
        
        // Use basic material - no shader compilation issues
        const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(0.4, 0.35, 0.3), // Brownish rock color
            side: THREE.DoubleSide,
        });
        
        return mat;
    }, []);  // No texture dependencies for now


    const generateNextSegment = useCallback((lastSegment) => {
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
    }, []);

    useFrame((state) => {
        // Update Rock Material Time
        if (rockMaterial.userData.shader) {
            rockMaterial.userData.shader.uniforms.time.value = state.clock.elapsedTime;
        }

        const currentSegments = segmentsRef.current;
        if (currentSegments.length === 0) return;

        // 1. GENERATION LOGIC
        const lastSegment = currentSegments[currentSegments.length - 1];
        if (lastSegment.id !== lastGeneratedFromId.current) {
            const lastPoint = lastSegment.points[lastSegment.points.length - 1];
            if (camera.position.z - lastPoint.z < GENERATION_THRESHOLD) {
                lastGeneratedFromId.current = lastSegment.id;
                const newSegment = generateNextSegment(lastSegment);

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
