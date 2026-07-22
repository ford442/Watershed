// RaftVehicle — Full Vortex Integration
// Complete integration of physics, visuals, and audio for vortex segments

import { useRef, useMemo } from 'react';
import { Vector3 } from 'three';
import { RigidBody } from '@react-three/rapier';
import FlowingWater from './FlowingWater';
import VortexVisual from './VortexVisual'; // ← NEW
import { useWaterFlowField } from '../hooks/useWaterFlowField';
import { useVortexForce } from '../hooks/useVortexForce'; // ← NEW
import { useRiverAudio } from '../hooks/useRiverAudio';

interface RaftProps {
  segmentPath?: any;
  initialPosition?: [number, number, number];
  waterGeometry?: THREE.BufferGeometry;
  flowSpeed?: number;
  currentBiome?: string;
  // ← NEW: Vortex props from TrackSegment
  isVortexSegment?: boolean;
  vortexCenter?: Vector3;
}

export default function Raft({
  segmentPath,
  initialPosition = [0, 0.5, 0],
  waterGeometry,
  flowSpeed = 1.2,
  currentBiome = 'river',
  // Vortex
  isVortexSegment = false,
  vortexCenter,
  ...props
}: RaftProps) {
  const shaderMatRef = useRef(null);
  const raftRigidBodyRef = useRef(null);

  // 🔥 PHYSICS: Normal flow field
  useWaterFlowField(shaderMatRef, raftRigidBodyRef, {
    forceMultiplier: 6.0,
    maxForce: 65,
    applyTorque: true,
    torqueMultiplier: 0.35,
    lookAheadDistance: 2.0,
  });

  // 🌀 PHYSICS: Vortex pull + spin (only active in vortex segments)
  useVortexForce(raftRigidBodyRef, isVortexSegment, vortexCenter || new Vector3(0, 0, 0), {
    strength: 52,        // Strong pull
    spinMultiplier: 2.3, // Fast rotation
    radius: 9,
    eyeRadius: 2.5,
    liftForce: 3,        // Slight upward suction
  });

  // 🎵 AUDIO: Reactive soundscape with vortex boost
  const audioAPI = useRiverAudio(shaderMatRef, currentBiome, isVortexSegment, {
    whooshSampleId: 'water-whoosh-001',
    impactSampleId: 'water-impact-001',
    musicIdsByBiome: {
      river: 'ambient-river-001',
      canyon: 'ambient-canyon-001',
      glacial: 'ambient-glacial-001',
      autumn: 'ambient-autumn-001',
    },
    masterVolume: 0.75,
    // Vortex audio boost
    enableVortexBoost: true,
    vortexVolumeBoost: 1.5,  // 50% louder
    vortexPitchDrop: 0.72,   // Deeper, more ominous
  });

  // Visual swirl intensity based on vortex state
  const swirlIntensity = isVortexSegment ? 1.8 : 0;

  return (
    <RigidBody
      ref={raftRigidBodyRef}
      type="dynamic"
      position={initialPosition}
      colliders="hull"
      mass={10}
      linearDamping={0.5}
      angularDamping={0.7} // Slightly reduced for more spin
      onCollisionEnter={() => audioAPI.playImpact()}
    >
      <group>
        {/* Raft mesh */}
        <mesh>
          <boxGeometry args={[2, 0.5, 3]} />
          <meshStandardMaterial color="#8B4513" />
        </mesh>

        {/* Water with vortex shader support */}
        <FlowingWater
          ref={shaderMatRef}
          geometry={waterGeometry}
          flowSpeed={flowSpeed}
          shaderId="water-test-v1"
          // Vortex props
          isVortex={isVortexSegment}
          swirlIntensity={swirlIntensity}
          swirlCenter={vortexCenter}
        />

        {/* 🌀 Visual swirl particles (only in vortex) */}
        {isVortexSegment && vortexCenter && (
          <VortexVisual
            center={vortexCenter}
            radius={9}
            intensity={1.8}
            particleCount={72}
            color="#5a9ae9"
          />
        )}
      </group>
    </RigidBody>
  );
}

/*
================================================================
TRACKMANAGER INTEGRATION — Add Vortex Spawn Chance
================================================================

In your TrackManager.tsx or createSegmentData function:

const createSegmentData = (index, previousSegment) => {
  // ... existing segment creation logic ...
  
  // Determine biome
  const biome = getBiomeForSegment(index);
  
  // 🌀 Vortex spawn chance (18% in canyon/fast biomes)
  const isVortex = 
    (biome === 'canyon' || biome === 'slotCanyon') && 
    Math.random() < 0.18;
  
  // Calculate vortex center if applicable
  const vortexCenter = isVortex 
    ? new Vector3(
        segmentPath.getPoint(0.5).x,
        WATER_LEVEL,
        segmentPath.getPoint(0.5).z
      )
    : null;

  return {
    ...segmentData,
    type: isVortex ? 'vortex' : 'normal',
    vortexCenter,
    biome,
  };
};

================================================================
TRACKSEGMENT INTEGRATION — Pass Props to Raft
================================================================

In your TrackSegment/:

export default function TrackSegment({ segmentData, ... }) {
  const isVortexSegment = segmentData.type === 'vortex';
  const vortexCenter = segmentData.vortexCenter;

  return (
    <group>
      {/* ... other segment content ... */}
      
      <Raft
        segmentPath={segmentPath}
        currentBiome={segmentData.biome}
        isVortexSegment={isVortexSegment}
        vortexCenter={vortexCenter}
        // ... other props ...
      />
    </group>
  );
}

================================================================
DEPLOY CHECKLIST
================================================================

1. Copy files:
   - useVortexForce.ts → src/hooks/
   - VortexVisual.tsx → src/components/
   - Update useRiverAudio.ts with vortex extension
   - Update RaftVehicle with integration

2. Update TrackManager with 18% vortex spawn chance

3. Build & deploy:
   npm run build

4. Test:
   - Navigate to canyon biome
   - Look for swirling particle ring
   - Feel the pull + spin when entering
   - Listen for audio boost (louder + deeper)

================================================================
*/
