import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import Pinecone from './Pinecone';

/**
 * FloatingDebris - Manages floating objects (pinecones) in the water stream
 * Creates debris that floats down the creek with the water flow
 * 
 * @param {THREE.Vector3} streamStart - Starting position for debris spawn
 * @param {THREE.Vector3} streamDirection - Direction of water flow (normalized)
 * @param {number} streamLength - Length of the stream segment
 * @param {number} waterLevel - Y position of water surface
 * @param {number} count - Number of debris items to spawn
 * @param {number} seed - Random seed for consistent generation
 */
export default function FloatingDebris({ 
  streamStart, 
  streamDirection, 
  streamLength = 50,
  waterLevel = 0.5,
  count = 8,
  seed = 0
}) {
  const debrisRefs = useRef([]);
  
  // Seeded random function for consistent generation
  const seededRandom = (s) => {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
  };

  // Generate initial positions for debris
  const debrisData = useMemo(() => {
    const items = [];
    let currentSeed = seed;
    
    for (let i = 0; i < count; i++) {
      // Spread debris along the stream
      const distanceAlongStream = seededRandom(currentSeed++) * streamLength;
      
      // Position relative to stream
      const position = new THREE.Vector3()
        .copy(streamStart)
        .add(streamDirection.clone().multiplyScalar(distanceAlongStream));
      
      // Add some lateral variation (slight offset from center)
      const lateralOffset = (seededRandom(currentSeed++) - 0.5) * 3; // ±1.5 units
      const lateral = new THREE.Vector3(-streamDirection.z, 0, streamDirection.x)
        .normalize()
        .multiplyScalar(lateralOffset);
      
      position.add(lateral);
      position.y = waterLevel + 0.1; // Float just above water
      
      // Random rotation
      const rotation = new THREE.Euler(
        seededRandom(currentSeed++) * Math.PI * 2,
        seededRandom(currentSeed++) * Math.PI * 2,
        seededRandom(currentSeed++) * Math.PI * 2
      );
      
      // Slightly varied size
      const scale = 0.4 + seededRandom(currentSeed++) * 0.3;
      
      // Random phase for bobbing animation
      const bobPhase = seededRandom(currentSeed++) * Math.PI * 2;
      
      // Speed variation
      const speedMultiplier = 0.8 + seededRandom(currentSeed++) * 0.4; // 0.8 to 1.2
      
      items.push({
        id: i,
        initialPosition: position.clone(),
        position,
        rotation,
        scale: new THREE.Vector3(scale, scale, scale),
        bobPhase,
        speedMultiplier
      });
    }
    
    return items;
  }, [streamStart, streamDirection, streamLength, waterLevel, count, seed]);

  // Animate debris floating down stream with bobbing motion
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    debrisData.forEach((item, index) => {
      const ref = debrisRefs.current[index];
      if (!ref) return;
      
      // Flow downstream
      const flowSpeed = 2.5 * item.speedMultiplier; // Units per second
      const flowDistance = (time * flowSpeed) % streamLength;
      
      // Calculate position along stream
      const position = new THREE.Vector3()
        .copy(item.initialPosition)
        .add(streamDirection.clone().multiplyScalar(flowDistance));
      
      // Add bobbing motion
      const bobAmount = Math.sin(time * 2 + item.bobPhase) * 0.08;
      position.y += bobAmount;
      
      // Add gentle rotation as it floats
      const rotation = new THREE.Euler(
        item.rotation.x + time * 0.3,
        item.rotation.y + time * 0.2,
        item.rotation.z + Math.sin(time + item.bobPhase) * 0.1
      );
      
      // Update rigid body position
      ref.setTranslation(position, false);
      ref.setRotation(rotation, false);
    });
  });

  return (
    <group name="floating-debris">
      {debrisData.map((item, index) => (
        <RigidBody
          key={item.id}
          ref={(el) => (debrisRefs.current[index] = el)}
          type="kinematicPosition"
          colliders="hull"
          sensor // No physical collision, just visual
        >
          <Pinecone transforms={[{
            position: [0, 0, 0],
            rotation: new THREE.Euler(0, 0, 0),
            scale: item.scale,
          }]} />
        </RigidBody>
      ))}
    </group>
  );
}
