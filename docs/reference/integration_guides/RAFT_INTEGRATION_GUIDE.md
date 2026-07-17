// Raft.jsx Integration Guide
// Boss Fight: Wire up useWaterFlowField to make the raft feel the current

import React, { useRef } from 'react';
import { RigidBody } from '@react-three/rapier';
import FlowingWater from './FlowingWater';
import { useWaterFlowField } from '../hooks/useWaterFlowField';

export default function Raft({ 
    segmentPath, 
    initialPosition,
    waterGeometry,
    flowSpeed = 1.2,
    ...props 
}) {
    // Refs for physics sync
    const shaderMatRef = useRef<THREE.ShaderMaterial>(null);
    const raftRigidBodyRef = useRef<any>(null);

    // 🔥 BOSS FIGHT: Sync raft to water flow field
    useWaterFlowField(shaderMatRef, raftRigidBodyRef, {
        forceMultiplier: 5.5,      // Tune this: higher = stronger push
        maxForce: 60,              // Cap to prevent runaway
        applyTorque: true,         // Enable rotation/drift
        torqueMultiplier: 0.3,     // Roll/yaw sensitivity
        lookAheadDistance: 2.0,    // Sample slightly ahead of raft
    });

    return (
        <group>
            {/* The water with dynamic shader */}
            <FlowingWater
                ref={shaderMatRef}              // ← Attach ref for flow sampling
                geometry={waterGeometry}
                flowSpeed={flowSpeed}
                shaderId="water-test-v1"        // ← Your hot-swappable shader
                onShaderLoad={(code, error) => {
                    if (error) console.warn('[Raft] Shader load failed:', error);
                    else console.log('[Raft] Shader loaded, flow sync active');
                }}
            />

            {/* The raft physics body */}
            <RigidBody
                ref={raftRigidBodyRef}          // ← Attach ref for force application
                type="dynamic"
                position={initialPosition}
                colliders="hull"
                mass={10}
                linearDamping={0.5}              // Water resistance
                angularDamping={0.8}             // Rotational resistance
            >
                <group>
                    {/* Raft mesh */}
                    <mesh>
                        <boxGeometry args={[2, 0.5, 3]} />
                        <meshStandardMaterial color="#8B4513" />
                    </mesh>
                    
                    {/* Raft details... */}
                </group>
            </RigidBody>
        </group>
    );
}

// ============================================================
// TUNING GUIDE
// ============================================================
//
// If the raft feels "floaty" or unresponsive:
//   - Increase forceMultiplier (try 7-10)
//   - Decrease linearDamping (try 0.3)
//
// If the raft is too twitchy:
//   - Decrease forceMultiplier (try 3-4)
//   - Increase linearDamping (try 0.7)
//   - Decrease torqueMultiplier (try 0.1)
//
// If the raft doesn't rotate enough with the current:
//   - Increase torqueMultiplier (try 0.5)
//   - Decrease angularDamping (try 0.5)
//
// If you want more "anticipation" of turns:
//   - Increase lookAheadDistance (try 5.0)
//
// ============================================================
// ALTERNATIVE: Spline-based sampling (more accurate)
// ============================================================
//
// If you want to sample the flow exactly on the river spline:
//
// const sampleFlowOnSpline = useCallback((raftZ: number) => {
//     if (!segmentPath) return { direction: new Vector3(0, 0, -1), speed: 1 };
//     
//     const t = Math.abs(raftZ) / segmentPath.getLength();
//     const tangent = segmentPath.getTangent(Math.min(1, t));
//     
//     // Add meander from shader math
//     const time = clock.elapsedTime;
//     const meander = Math.sin(raftZ * 0.35 - time * flowSpeed * 0.15) * 0.25;
//     
//     return {
//         direction: new Vector3(meander, 0, -1).normalize(),
//         speed: flowSpeed * (1 + Math.sin(raftZ * 0.35 + meander) * 0.12),
//     };
// }, [segmentPath, flowSpeed]);
