import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import TrackSegment from './TrackSegment';

const GENERATION_THRESHOLD = 150; // Generate sooner so we don't see the pop-in
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

export default function TrackManager() {
    const [segments, setSegments] = useState(INITIAL_SEGMENTS);
    const segmentsRef = useRef(INITIAL_SEGMENTS);
    const lastSegmentId = useRef(1);
    const lastGeneratedFromId = useRef(-1);
    const { camera } = useThree();

    // Track global meandering phase to make turns continuous across segments
    const meanderPhase = useRef(0);

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

        // 1. Summer Creek (Winding)
        if (currentId <= 12) {
            nextType = 'normal';
            nextBiome = 'summer';
            verticalBias = -0.5;
            meanderStrength = 1.2; // High winding
        }
        // 2. Waterfall Approach (Straight & Steep)
        else if (currentId === 13) {
            nextType = 'normal';
            nextBiome = 'summer';
            verticalBias = -1.2;
            meanderStrength = 0.2; // Straighten out
        }
        // 3. THE WATERFALL (Vertical)
        else if (currentId === 14) {
            nextType = 'waterfall';
            nextBiome = 'summer';
            verticalBias = -3.0;
            meanderStrength = 0.0;
            segmentLengthMult = 0.5;
        }
        // 4. Recovery / Splash Pool
        else if (currentId === 15) {
            nextType = 'normal'; // Transition
            nextBiome = 'autumn'; // Season change!
            verticalBias = -0.2;
            meanderStrength = 0.5;
        }
        // 5. THE POND (Flat, Wide, Calm)
        else if (currentId >= 16 && currentId <= 18) {
            nextType = 'pond';
            nextBiome = 'autumn';
            verticalBias = -0.02; // Very slight flow
            meanderStrength = 0.3; // Gentle curves
            segmentLengthMult = 1.2;
        }
        // 6. Autumn Rapids (Fast again)
        else {
            nextType = 'normal';
            nextBiome = 'autumn';
            verticalBias = -0.7;
            meanderStrength = 1.5; // Very twisty
        }

        // --- GENERATION MATH ---
        // 1. Get current heading
        const direction = new THREE.Vector3().subVectors(lastPoint, prevPoint).normalize();

        const newPoints = [lastPoint.clone()];
        let currentPos = lastPoint.clone();

        // 2. Generate Control Points
        for (let i = 0; i < 3; i++) {
            // A. Meandering (Sine Wave Steering)
            // We advance the phase to create a continuous sine curve along the track
            meanderPhase.current += 0.5;
            const turnFactor = Math.sin(meanderPhase.current) * meanderStrength;

            // Apply turn to X (Left/Right)
            direction.x += turnFactor * 0.3;

            // Add some random noise so it's not a perfect sine wave
            direction.x += (Math.random() - 0.5) * 0.2;

            // B. Gravity (Vertical)
            // Add the bias
            direction.y += (Math.random() * 0.2 + verticalBias * 0.2);

            // HARD CLAMP: Ensure we never point UP
            // For Ponds, we allow essentially flat (-0.01). For others, ensure gravity.
            const maxUpward = nextType === 'pond' ? -0.01 : -0.1;
            if (direction.y > maxUpward) direction.y = maxUpward;

            // C. Forward Momentum (Z)
            // Ensure we don't turn 90 degrees and stop moving forward
            direction.normalize();
            if (nextType !== 'waterfall') {
                if (direction.z > -0.5) direction.z = -0.5; // Keep moving forward
            } else {
                direction.z = -0.1; // Waterfalls drop, don't move forward much
            }

            // Re-normalize after constraints
            direction.normalize();

            // D. Step Distance
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
        const lastSegment = currentSegments[currentSegments.length - 1];

        // Don't generate duplicates
        if (lastSegment.id === lastGeneratedFromId.current) return;

        const lastPoint = lastSegment.points[lastSegment.points.length - 1];

        // Generate when player gets within range
        // Note: Camera Z is negative, so we check if (CamZ - LastPointZ) is small
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
                // Map segment ID to pool index to maintain React keys
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
