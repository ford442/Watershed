import React, { useMemo } from 'react';
import * as THREE from 'three';
import TrackSegment from './TrackSegment';

/**
 * TrackManager - Manages multiple track segments for the treadmill system
 * 
 * This component generates and manages track segments. Currently uses static
 * segments, but designed to support dynamic loading/unloading.
 * 
 * TODO (Priority A): Implement dynamic segment loading based on player position
 * TODO (Priority B): Add object pooling for segments
 */
export default function TrackManager() {
    // Define segment configurations
    // Each segment is an array of Vector3 points
    const segments = useMemo(() => [
        // Segment 1: Start zone - gentle introduction
        {
            id: 0,
            points: [
                new THREE.Vector3(0, 0, 0),       // START
                new THREE.Vector3(0, 0, -20),     // SAFE ZONE
                new THREE.Vector3(5, -2, -50),    // Gentle curve right
                new THREE.Vector3(10, -5, -80),   // Continue drop
            ],
        },
        // Segment 2: The big turn
        {
            id: 1,
            points: [
                new THREE.Vector3(10, -5, -80),   // Connect from segment 1
                new THREE.Vector3(5, -10, -100),  // Begin left turn
                new THREE.Vector3(-10, -15, -130),// Hard left
                new THREE.Vector3(-20, -20, -160),// Continue descent
            ],
        },
    ], []);

    return (
        <group name="track-manager">
            {segments.map((segment) => (
                <TrackSegment
                    key={segment.id}
                    segmentId={segment.id}
                    pathPoints={segment.points}
                />
            ))}
        </group>
    );
}
