import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import TrackSegment from './TrackSegment';

const GENERATION_THRESHOLD = 100;
const MAX_ACTIVE_SEGMENTS = 6;    // Increased slightly to see further
const POOL_SIZE = 9;

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
            new THREE.Vector3(0, -16, -95),
            new THREE.Vector3(-12, -20, -135),
            new THREE.Vector3(-18, -24, -175),
        ],
    },
];

export default function TrackManager() {
    const [segments, setSegments] = useState(INITIAL_SEGMENTS);
    const segmentsRef = useRef(INITIAL_SEGMENTS);
    const lastSegmentId = useRef(1);
    const lastGeneratedFromId = useRef(-1);
    const { camera } = useThree();

    useEffect(() => {
        segmentsRef.current = segments;
    }, [segments]);

    const generateNextSegment = useCallback((lastSegment) => {
        const lastPoints = lastSegment.points;
        const lastPoint = lastPoints[lastPoints.length - 1];
        const prevPoint = lastPoints[lastPoints.length - 2];
        const currentId = lastSegmentId.current + 1;

        // --- LEVEL DIRECTOR LOGIC ---
        let nextType = 'normal';
        let nextBiome = 'summer';
        let verticalBias = -0.3; // Default slope
        let curveRoughness = 0.8; // How much it turns left/right
        let segmentLengthMult = 1.0;

        // Phase 1: Summer Creek (Id 0-8)
        if (currentId <= 8) {
            nextType = 'normal';
            nextBiome = 'summer';
            verticalBias = -0.4; // Getting steeper
        }
        // Phase 2: Waterfall Approach (Id 9)
        else if (currentId === 9) {
            nextType = 'normal';
            nextBiome = 'summer';
            verticalBias = -0.8; // Very steep approach
        }
        // Phase 3: THE WATERFALL (Id 10)
        else if (currentId === 10) {
            nextType = 'waterfall';
            nextBiome = 'summer';
            verticalBias = -2.5; // Extreme drop
            curveRoughness = 0.1; // Straight drop
            segmentLengthMult = 0.6; // Shorter distance, all vertical
        }
        // Phase 4: THE POND (Id 11) - Transition to Autumn
        else if (currentId === 11) {
            nextType = 'pond';
            nextBiome = 'autumn';
            verticalBias = -0.05; // Almost flat
            curveRoughness = 0.2; // Gentle curves
            segmentLengthMult = 1.5; // Long pond
        }
        // Phase 5: Autumn Rapids (Id 12+)
        else {
            nextType = 'normal';
            nextBiome = 'autumn';
            verticalBias = -0.6; // Steep rapids
            curveRoughness = 1.0; // Lots of twists
        }

        // --- GENERATION MATH ---
        const direction = new THREE.Vector3().subVectors(lastPoint, prevPoint).normalize();
        const newPoints = [lastPoint.clone()];
        let currentPos = lastPoint.clone();

        for (let i = 0; i < 3; i++) {
            // Randomness based on Level Director settings
            const randomX = (Math.random() - 0.5) * curveRoughness;
            const randomY = (Math.random() * verticalBias);

            direction.x += randomX;
            direction.y += randomY;
            direction.normalize();

            // Constraints
            if (nextType !== 'waterfall') {
                // Don't let normal segments loop back or drop TOO fast
                if (direction.z > -0.4) direction.z = -0.4;
                if (direction.y < -0.8 && nextType !== 'waterfall') direction.y = -0.8;
            } else {
                // Waterfall specific constraints
                 if (direction.y > -0.9) direction.y = -0.9; // Force Down
                 direction.z = -0.1; // Very little forward movement
            }

            const baseDist = 30 + Math.random() * 20;
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
        const lastSegment = currentSegments[currentSegments.length - 1];
        if (lastSegment.id === lastGeneratedFromId.current) return;

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
