import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import TrackSegment from './TrackSegment';

const GENERATION_THRESHOLD = 150;
const MAX_ACTIVE_SEGMENTS = 7;
const POOL_SIZE = 10;

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

export default function TrackManager({ onBiomeChange }) {
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

    const generateNextSegment = useCallback((lastSegment) => {
        const lastPoints = lastSegment.points;
        const lastPoint = lastPoints[lastPoints.length - 1];
        const prevPoint = lastPoints[lastPoints.length - 2];
        const currentId = lastSegmentId.current + 1;

        // --- LEVEL DIRECTOR ---
        let nextType = 'normal';
        let nextBiome = 'summer';
        let verticalBias = -0.4;
        let meanderStrength = 0.5;
        let segmentLengthMult = 1.0;

        // 1. Summer Creek
        if (currentId <= 12) {
            nextType = 'normal';
            nextBiome = 'summer';
            verticalBias = -0.5;
            meanderStrength = 1.2;
        }
        // 2. Waterfall Approach
        else if (currentId === 13) {
            nextType = 'normal';
            nextBiome = 'summer';
            verticalBias = -1.2;
            meanderStrength = 0.2;
        }
        // 3. THE WATERFALL
        else if (currentId === 14) {
            nextType = 'waterfall';
            nextBiome = 'summer';
            verticalBias = -3.0;
            meanderStrength = 0.0;
            segmentLengthMult = 0.5;
        }
        // 4. Recovery / Splash Pool (Biome Transition)
        else if (currentId === 15) {
            nextType = 'normal';
            nextBiome = 'autumn';
            verticalBias = -0.2;
            meanderStrength = 0.5;
        }
        // 5. THE POND
        else if (currentId >= 16 && currentId <= 18) {
            nextType = 'pond';
            nextBiome = 'autumn';
            verticalBias = -0.02;
            meanderStrength = 0.3;
            segmentLengthMult = 1.2;
        }
        // 6. Autumn Rapids
        else {
            nextType = 'normal';
            nextBiome = 'autumn';
            verticalBias = -0.7;
            meanderStrength = 1.5;
        }

        // --- GENERATION MATH ---
        const direction = new THREE.Vector3().subVectors(lastPoint, prevPoint).normalize();
        const newPoints = [lastPoint.clone()];
        let currentPos = lastPoint.clone();

        for (let i = 0; i < 3; i++) {
            meanderPhase.current += 0.5;
            const turnFactor = Math.sin(meanderPhase.current) * meanderStrength;

            direction.x += turnFactor * 0.3;
            direction.x += (Math.random() - 0.5) * 0.2;
            direction.y += (Math.random() * 0.2 + verticalBias * 0.2);

            const maxUpward = nextType === 'pond' ? -0.01 : -0.1;
            if (direction.y > maxUpward) direction.y = maxUpward;

            direction.normalize();
            if (nextType !== 'waterfall') {
                if (direction.z > -0.5) direction.z = -0.5;
            } else {
                direction.z = -0.1;
            }
            direction.normalize();

            const baseDist = 30 + Math.random() * 10;
            const dist = baseDist * segmentLengthMult;

            const step = direction.clone().multiplyScalar(dist);
            currentPos.add(step);
            newPoints.push(currentPos.clone());
        }

        lastSegmentId.current = currentId;

        return {
            id: currentId,
            points: newPoints,
            type: nextType,
            biome: nextBiome
        };
    }, []);

    useFrame(() => {
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
                        segmentId={segment ? segment.id : -1}
                        pathPoints={segment ? segment.points : null}
                        active={!!segment}
                        type={segment ? segment.type : 'normal'}
                        biome={segment ? segment.biome : 'summer'}
                    />
                );
            })}
        </group>
    );
}
