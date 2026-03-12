import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { extendRiverMaterial } from '../utils/RiverShader';
import TrackSegment from './TrackSegment';
import { 
  JSONMapManager, 
  JSONLevelLoader, 
  DEFAULT_MAP_CONFIG,
  generateRiverPath,
  SeededRandom 
} from '../systems/MapSystem';

const GENERATION_THRESHOLD = 150;
const MAX_ACTIVE_SEGMENTS = 7;
const POOL_SIZE = 10;

/**
 * Convert MapSystem chunk to TrackManager segment format
 */
function chunkToSegment(chunk, rockMaterial) {
  return {
    id: chunk.index,
    type: chunk.biome === 'autumn' ? 'normal' : 'normal', // Map as needed
    biome: chunk.biome,
    points: chunk.pathPoints,
    width: chunk.canyonWidth,
    waterWidth: chunk.waterWidth,
    flowSpeed: chunk.flowSpeed,
    rockMaterial,
    // Pass spawns for decoration
    spawns: chunk.spawns,
  };
}

/**
 * Generate fallback segments when no level data is provided
 * Uses procedural generation via MapSystem utilities
 */
function generateFallbackSegment(index, previousSegment) {
  const rng = new SeededRandom(12345 + index * 1000);
  
  // Phase-based configuration
  const getPhaseConfig = (id) => {
    const base = {
      biome: 'summer',
      width: 35,
      meanderStrength: 1.2,
      verticalBias: -0.5,
      flowSpeed: 1.0,
      treeDensity: 1.0,
      rockDensity: 'low'
    };

    if (id <= 12) return base;
    if (id === 13) return { ...base, meanderStrength: 0.2, verticalBias: -1.2 };
    if (id === 14) return {
      ...base, type: 'waterfall', verticalBias: -3.0, meanderStrength: 0.0,
      forwardMomentum: 0.15, particleCount: 400, cameraShake: 0.5
    };
    if (id === 15) return {
      ...base, type: 'splash', biome: 'autumn', verticalBias: -0.2,
      meanderStrength: 0.5, width: 70, flowSpeed: 0.3
    };
    if (id >= 16 && id <= 18) return {
      ...base, type: 'pond', biome: 'autumn', verticalBias: -0.02,
      meanderStrength: 0.3, width: 70, treeDensity: 0.3
    };
    if (id >= 19) return {
      ...base, biome: 'autumn', verticalBias: -0.7,
      meanderStrength: 1.5, rockDensity: 'high'
    };
    return base;
  };

  const config = getPhaseConfig(index);
  const lastPoints = previousSegment?.points || [
    new THREE.Vector3(0, -6, 30),
    new THREE.Vector3(0, -6, 5),
    new THREE.Vector3(2, -8, -25),
    new THREE.Vector3(8, -12, -60),
  ];
  
  const lastPoint = lastPoints[lastPoints.length - 1];
  const prevPoint = lastPoints[lastPoints.length - 2] || new THREE.Vector3(0, -6, 30);
  
  const direction = new THREE.Vector3().subVectors(lastPoint, prevPoint).normalize();
  const newPoints = [lastPoint.clone()];
  let currentPos = lastPoint.clone();

  for (let i = 0; i < 3; i++) {
    const turnFactor = Math.sin(index * 0.5 + i) * config.meanderStrength;
    direction.x += turnFactor * 0.3 + (rng.next() - 0.5) * 0.2;
    direction.y += (rng.next() * 0.2 + config.verticalBias * 0.2);
    
    const maxUpward = config.type === 'pond' ? -0.01 : -0.1;
    if (direction.y > maxUpward) direction.y = maxUpward;
    
    direction.normalize();
    if (config.type !== 'waterfall') {
      if (direction.z > -0.5) direction.z = -0.5;
    } else {
      direction.z = -0.1;
    }
    direction.normalize();

    const dist = (30 + rng.next() * 10);
    const step = direction.clone().multiplyScalar(dist);
    currentPos.add(step);
    newPoints.push(currentPos.clone());
  }

  return {
    id: index,
    type: config.type || 'normal',
    biome: config.biome,
    points: newPoints,
    width: config.width,
    flowSpeed: config.flowSpeed,
    particleCount: config.particleCount || 0,
    cameraShake: config.cameraShake || 0,
    treeDensity: config.treeDensity,
    rockDensity: config.rockDensity,
  };
}

/**
 * TrackManager Component
 * 
 * Manages track generation using MapSystem for JSON-driven map authoring.
 * Supports both JSON level files and procedural fallback generation.
 * 
 * Props:
 * - onBiomeChange: Callback when player enters different biome
 * - raftRef: Reference to player raft for position tracking
 * - levelState: Optional level data from LevelLoader (enables custom maps)
 * - levelUrl: Optional URL to load level from
 */
export default function TrackManager({ onBiomeChange, raftRef, levelState, levelUrl }) {
  const { camera } = useThree();
  const [segments, setSegments] = useState([]);
  const segmentsRef = useRef([]);
  const lastReportedBiome = useRef('summer');
  
  // MapSystem manager instance
  const mapManagerRef = useRef(null);
  
  // Track if we're using JSON-driven or fallback generation
  const useJSONMode = useRef(false);

  // --- SHARED MATERIAL ASSETS ---
  const [colorMap, normalMap, roughnessMap, aoMap] = useTexture([
    './Rock031_1K-JPG_Color.jpg',
    './Rock031_1K-JPG_NormalGL.jpg',
    './Rock031_1K-JPG_Roughness.jpg',
    './Rock031_1K-JPG_AmbientOcclusion.jpg',
  ]);

  useEffect(() => {
    [colorMap, normalMap, roughnessMap, aoMap].forEach(texture => {
      if (texture) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4, 8);
      }
    });
  }, [colorMap, normalMap, roughnessMap, aoMap]);

  const rockMaterial = useMemo(() => {
    if (!colorMap || !normalMap) {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.4, 0.35, 0.3),
        roughness: 0.9,
        metalness: 0,
        vertexColors: true,
        side: THREE.DoubleSide,
      });
    }
    const mat = new THREE.MeshStandardMaterial({
      map: colorMap,
      normalMap: normalMap,
      roughnessMap: roughnessMap || undefined,
      aoMap: aoMap || undefined,
      roughness: 0.85,
      metalness: 0.05,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    extendRiverMaterial(mat);
    return mat;
  }, [colorMap, normalMap, roughnessMap, aoMap]);

  // Initialize MapSystem with level data
  useEffect(() => {
    const initMap = async () => {
      try {
        if (levelState) {
          // Load from provided level state
          const levelData = JSONLevelLoader.loadFromObject(levelState);
          mapManagerRef.current = new JSONMapManager(levelData);
          useJSONMode.current = true;
        } else if (levelUrl) {
          // Load from URL
          mapManagerRef.current = new JSONMapManager();
          await mapManagerRef.current.loadFromUrl(levelUrl);
          useJSONMode.current = true;
        } else {
          // Fallback to procedural mode - no MapSystem needed
          useJSONMode.current = false;
          // Generate initial fallback segments
          const initialSegments = [];
          let prevSegment = null;
          for (let i = 0; i < 2; i++) {
            const seg = generateFallbackSegment(i, prevSegment);
            initialSegments.push(seg);
            prevSegment = seg;
          }
          setSegments(initialSegments);
          return;
        }

        // Convert initial chunks to segments
        const chunks = mapManagerRef.current.chunks;
        const initialSegments = chunks.map(chunk => chunkToSegment(chunk, rockMaterial));
        setSegments(initialSegments);
        
      } catch (error) {
        console.error('[TrackManager] Failed to initialize map:', error);
        // Fallback to procedural on error
        useJSONMode.current = false;
        const initialSegments = [];
        let prevSegment = null;
        for (let i = 0; i < 2; i++) {
          const seg = generateFallbackSegment(i, prevSegment);
          initialSegments.push(seg);
          prevSegment = seg;
        }
        setSegments(initialSegments);
      }
    };

    initMap();
  }, [levelState, levelUrl, rockMaterial]);

  // Update segments ref
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  // Main update loop
  useFrame((state) => {
    // Update material time
    if (rockMaterial.userData?.shader?.uniforms?.time) {
      rockMaterial.userData.shader.uniforms.time.value = state.clock.elapsedTime;
    }

    const cameraPos = camera.position;

    // Update MapSystem
    if (useJSONMode.current && mapManagerRef.current) {
      mapManagerRef.current.update(cameraPos);
      
      // Sync chunks to segments
      const chunks = mapManagerRef.current.chunks;
      const newSegments = chunks.map(chunk => chunkToSegment(chunk, rockMaterial));
      
      // Only update if changed
      if (newSegments.length !== segmentsRef.current.length ||
          newSegments[newSegments.length - 1]?.id !== segmentsRef.current[segmentsRef.current.length - 1]?.id) {
        setSegments(newSegments);
      }
    } else {
      // Fallback procedural generation
      const currentSegments = segmentsRef.current;
      if (currentSegments.length === 0) return;

      const lastSegment = currentSegments[currentSegments.length - 1];
      const lastPoint = lastSegment.points[lastSegment.points.length - 1];

      // Generate new segment if needed
      if (cameraPos.z - lastPoint.z < GENERATION_THRESHOLD) {
        const newSegment = generateFallbackSegment(lastSegment.id + 1, lastSegment);
        
        setSegments(prev => {
          const updated = [...prev, newSegment];
          if (updated.length > MAX_ACTIVE_SEGMENTS) {
            return updated.slice(updated.length - MAX_ACTIVE_SEGMENTS);
          }
          return updated;
        });
      }
    }

    // Biome detection
    if (onBiomeChange) {
      const currentSegments = segmentsRef.current;
      let closestSegment = null;
      let minDistance = Infinity;
      const camZ = cameraPos.z;

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
        
        // Dispatch global biome change event for vehicles
        window.dispatchEvent(new CustomEvent('biome-change', {
          detail: { biome: closestSegment.biome }
        }));
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
