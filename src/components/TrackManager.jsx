import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import TrackSegment from './TrackSegment';

const GENERATION_THRESHOLD = 100; // Distance from end to trigger generation
const MAX_ACTIVE_SEGMENTS = 5;    // Keep last 5 segments active in logic
const POOL_SIZE = 8;              // Total number of pooled components (buffer > MAX_ACTIVE)

// Define initial segments outside component to avoid recreation
const INITIAL_SEGMENTS = [
    // Segment 1: Start zone - enclosed creek corridor
    {
        id: 0,
        points: [
            new THREE.Vector3(0, -6, 30),     // Upstream canyon approach
            new THREE.Vector3(0, -6, 5),      // Entry corridor around spawn
            new THREE.Vector3(2, -8, -25),    // Safe drop deeper into creek
            new THREE.Vector3(8, -12, -60),   // Continue descent
        ],
    },
    // Segment 2: The big turn
    {
        id: 1,
        points: [
            new THREE.Vector3(8, -12, -60),   // Connect from segment 1
            new THREE.Vector3(0, -16, -95),   // Begin left turn
            new THREE.Vector3(-12, -20, -135),// Hard left
            new THREE.Vector3(-18, -24, -175),// Continue descent
        ],
    },
];

/**
 * TrackManager - Manages multiple track segments for the treadmill system
 * 
 * Dynamically generates and manages track segments based on player position.
 * Implements object pooling to reuse React components.
 */
export default function TrackManager() {
    const [segments, setSegments] = useState(INITIAL_SEGMENTS);
    const segmentsRef = useRef(INITIAL_SEGMENTS);
    const lastSegmentId = useRef(1);
    // Ref to track which segment we last generated from to avoid duplicates
    const lastGeneratedFromId = useRef(-1);
    const { camera } = useThree();

    // Keep ref in sync for useFrame
    useEffect(() => {
        segmentsRef.current = segments;
    }, [segments]);

    // Helper to generate next segment
    const generateNextSegment = useCallback((lastSegment) => {
        const lastPoints = lastSegment.points;
        const lastPoint = lastPoints[lastPoints.length - 1];
        const prevPoint = lastPoints[lastPoints.length - 2];

        // Calculate tangent direction at the end of the last segment
        const direction = new THREE.Vector3().subVectors(lastPoint, prevPoint).normalize();

        // Start new segment points with the last point of the previous one (continuity)
        const newPoints = [lastPoint.clone()];
        let currentPos = lastPoint.clone();

        // Generate 3 new control points for the segment
        for (let i = 0; i < 3; i++) {
            // Apply some randomness to direction
            // Bias towards going down (-Y)

            const randomX = (Math.random() - 0.5) * 0.8;
            const randomY = (Math.random() * -0.3); // Always down or flat

            // Perturb direction
            direction.x += randomX;
            direction.y += randomY;

            // Re-normalize but ensure we are still moving generally forward (-Z)
            direction.normalize();

            // Prevent turning back or going too steep
            if (direction.z > -0.4) direction.z = -0.4;
            if (direction.y < -0.6) direction.y = -0.6; // Not too steep drop
            direction.normalize();

            // Move forward by a step distance
            const dist = 30 + Math.random() * 20; // 30-50 units
            const step = direction.clone().multiplyScalar(dist);

            currentPos.add(step);
            newPoints.push(currentPos.clone());
        }

        lastSegmentId.current += 1;

        return {
            id: lastSegmentId.current,
            points: newPoints
        };
    }, []);

    useFrame(() => {
        const currentSegments = segmentsRef.current;
        if (currentSegments.length === 0) return;

        const lastSegment = currentSegments[currentSegments.length - 1];

        // Prevent multiple generations from the same segment
        if (lastSegment.id === lastGeneratedFromId.current) return;

        const lastPoint = lastSegment.points[lastSegment.points.length - 1];

        // Check distance in Z.
        // We assume the track moves primarily in -Z direction.
        if (camera.position.z - lastPoint.z < GENERATION_THRESHOLD) {
            lastGeneratedFromId.current = lastSegment.id;
            const newSegment = generateNextSegment(lastSegment);

            setSegments(prev => {
                const updated = [...prev, newSegment];
                // Remove old segments if we have too many
                if (updated.length > MAX_ACTIVE_SEGMENTS) {
                    return updated.slice(updated.length - MAX_ACTIVE_SEGMENTS);
                }
                return updated;
            });
        }
    });

    return (
        <group name="track-manager">
            {/*
                Render a fixed pool of TrackSegment components.
                Each active segment is mapped to a pool slot based on id % POOL_SIZE.
                This ensures stable React keys (0..POOL_SIZE-1) to prevent unmounting/remounting
                of the component wrappers, optimizing React Fiber reconciliation.
            */}
            {Array.from({ length: POOL_SIZE }).map((_, index) => {
                // Find if any active segment belongs in this pool slot
                const segment = segments.find(s => (s.id % POOL_SIZE) === index);

                return (
                    <TrackSegment
                        key={index} // Stable key based on pool index
                        segmentId={segment ? segment.id : -1}
                        pathPoints={segment ? segment.points : null}
                        active={!!segment}
                    />
                );
            })}
        </group>
    );
}
