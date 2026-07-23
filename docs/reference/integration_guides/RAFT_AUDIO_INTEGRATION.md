// RaftVehicle Integration — Audio Layer
// Add this to your existing Raft component

import { useRef } from 'react';
import { RigidBody } from '@react-three/rapier';
import FlowingWater from './FlowingWater';
import { useWaterFlowField } from '../hooks/useWaterFlowField';
import { useRiverAudio } from '../hooks/useRiverAudio'; // ← NEW

export default function Raft({ 
    segmentPath,
    initialPosition,
    waterGeometry,
    flowSpeed = 1.2,
    currentBiome = 'river', // ← Pass biome for music switching
    ...props 
}) {
    // Refs for physics and audio sync
    const shaderMatRef = useRef(null);
    const raftRigidBodyRef = useRef(null);

    // 🔥 PHYSICS: Sync raft to water flow
    useWaterFlowField(shaderMatRef, raftRigidBodyRef, {
        forceMultiplier: 6.0,   // Tuned sweet spot
        maxForce: 65,
        applyTorque: true,
        torqueMultiplier: 0.35,
        lookAheadDistance: 2.0,
    });

    // 🎵 AUDIO: Reactive soundscape
    const audioAPI = useRiverAudio(shaderMatRef, currentBiome, {
        whooshSampleId: 'water-whoosh-001',      // Upload to /api/samples
        impactSampleId: 'water-impact-001',      // Upload to /api/samples
        musicIdsByBiome: {
            river: 'ambient-river-001',          // Upload to /api/music
            canyon: 'ambient-canyon-001',
            glacial: 'ambient-glacial-001',
            autumn: 'ambient-autumn-001',
            slotCanyon: 'ambient-canyon-001',
        },
        masterVolume: 0.75,
        debug: process.env.NODE_ENV === 'development',
    });

    // Optional: Trigger impact on collision
    const handleCollision = () => {
        audioAPI.playImpact();
    };

    return (
        <RigidBody
            ref={raftRigidBodyRef}
            type="dynamic"
            position={initialPosition}
            colliders="hull"
            mass={10}
            linearDamping={0.5}
            angularDamping={0.8}
            onCollisionEnter={handleCollision} // ← Triggers impact thud
        >
            <group>
                {/* Raft mesh */}
                <mesh>
                    <boxGeometry args={[2, 0.5, 3]} />
                    <meshStandardMaterial color="#8B4513" />
                </mesh>

                {/* The water with shader + flow field */}
                <FlowingWater
                    ref={shaderMatRef}
                    geometry={waterGeometry}
                    flowSpeed={flowSpeed}
                    shaderId="water-test-v1"
                    onShaderLoad={(code, error) => {
                        if (error) console.warn('[Raft] Shader load failed:', error);
                        else console.log('[Raft] Shader loaded, flow + audio sync active');
                    }}
                />
            </group>
        </RigidBody㺎
    );
}

/*
================================================================
UPLOADING AUDIO TO YOUR BACKEND
================================================================

1. Water Whoosh Sample:
   POST /api/samples/upload
   - Continuous water rushing sound
   - Should loop cleanly
   - 5-10 seconds duration

2. Impact Sample:
   POST /api/samples/upload  
   - Short splash/thud sound
   - 0.5-1 second duration
   - Used for wave hits

3. Ambient Music Tracks:
   POST /api/music/upload
   - One per biome
   - Should loop cleanly
   - Calm, atmospheric

================================================================
TUNING THE AUDIO
================================================================

Too quiet?
  → Increase masterVolume: 0.75 → 0.9

Whoosh too loud in calm water?
  → Reduce whoosh volume multiplier in useRiverAudio (0.6 → 0.4)

Want more impacts?
  → Increase impact chance (0.08 → 0.15)
  → Reduce cooldown (400ms → 200ms)

Music too loud?
  → Reduce ambient multiplier (0.35 → 0.25)

Cross-fade too slow?
  → Reduce fade interval (80ms → 50ms)

================================================================
*/
