// Biome Integration Guide
// Add Lumber Flume and Glacial Melt to Watershed

/*
================================================================
STEP 1: Copy Files
================================================================

1. Copy biomes.ts to src/constants/biomes.ts
2. Replace FlowingWater.jsx with FlowingWater-Biome.jsx (or merge changes)
3. Copy LumberProps.tsx to src/components/LumberProps.tsx

================================================================
STEP 2: Update TrackManager.jsx
================================================================

import { BIOMES, getNextBiome, type BiomeKey } from '../constants/biomes';

// Inside component state:
const [currentBiome, setCurrentBiome] = useState<BiomeKey>('river');

// When building segments:
const buildSegment = (index, previousSegment) => {
  const biomeData = BIOMES[currentBiome];
  
  // Occasionally shift biomes (25% chance every 3-5 segments)
  if (Math.random() < 0.25 && index % 4 === 0) {
    setCurrentBiome(getNextBiome(currentBiome));
  }
  
  return {
    ...segmentData,
    biome: currentBiome,
    vortexChance: biomeData.vortexChance,
    // ... other props
  };
};

================================================================
STEP 3: Update TrackSegment.jsx
================================================================

import { BIOMES, type BiomeKey } from '../constants/biomes';
import LumberProps from './LumberProps';

interface TrackSegmentProps {
  segmentData: {
    biome: BiomeKey;
    // ... other fields
  };
}

export default function TrackSegment({ segmentData, ... }) {
  const biome = segmentData.biome || 'river';
  const biomeData = BIOMES[biome];
  
  // Generate prop positions based on biome
  const propPositions = useMemo(() => {
    const positions = [];
    const count = biome === 'flume' ? 12 : 6;
    
    for (let i = 0; i < count; i++) {
      positions.push(new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        0.2,
        (Math.random() - 0.5) * 40
      ));
    }
    return positions;
  }, [biome]);

  return (
    <group>
      {/* ... existing segment content ... */}
      
      <FlowingWater
        biome={biome}
        // ... other props
      />
      
      {/* Lumber Flume debris */}
      {biome === 'flume' && (
        <>
          <LumberProps type="plank" positions={propPositions.slice(0, 6)} />
          <LumberProps type="log" positions={propPositions.slice(3, 8)} />
          <LumberProps type="barrel" positions={propPositions.slice(6, 10)} />
        </>
      )}
    </group>
  );
}

================================================================
STEP 4: Update Raft/GameHUD
================================================================

// Pass currentBiome through for audio and UI
<GameHUD
  rigidBodyRef={raftRigidBodyRef}
  isWipeout={isWipeout}
  onRespawn={handleRespawn}
  currentBiome={currentBiome}
/>

<useRiverAudio
  shaderMaterialRef={shaderMatRef}
  currentBiome={currentBiome}
  // ... other props
/>

================================================================
STEP 5: Upload Biome Music
================================================================

Upload these tracks to your /api/music endpoint:

- ambient-flume-001: Fast-paced, wooden percussion, rushing water
- ambient-glacial-001: Ethereal, icy tones, slow majestic feel

================================================================
STEP 6: Optional - Lumber Flume Shader
================================================================

Upload a shader called 'flume-turbulent-v1' with:
- More turbulent foam patterns
- Brownish water tint
- Faster flow speed feel

Or use the automatic biome tints — the waterColor/foamColor will
shift automatically based on the biome prop.

================================================================
BIOME PROGRESSION IDEAS
================================================================

Natural flow:
  River → Canyon (faster, narrower)
  Canyon → Flume (chaotic wooden speed)
  Flume → River (calm recovery)
  River → Glacial (majestic slow section)
  Glacial → Canyon (dramatic transition)

================================================================
TUNING NOTES
================================================================

Lumber Flume:
- High waterSpeed (3.4) = intense fast section
- High flowMultiplier (1.8) = stronger physics push
- Medium vortexChance (0.12) = occasional chaos
- Wood debris = visual clutter, obstacles

Glacial Melt:
- Lower waterSpeed (1.8) = slower, majestic
- Lower vortexChance (0.05) = rare, dramatic when it happens
- Ice chunks = bigger, reflective props
- Turquoise water = distinct visual identity

================================================================
*/
