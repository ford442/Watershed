import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

export const WaterFlowForce = ({ position, raftRef, flowSpeed = 1.0 }) => {
  const lastPushTime = useRef(0);

  useFrame(() => {
    if (!raftRef?.current) return;

    const raftPos = raftRef.current.translation();
    
    // Calculate distance to this segment's center (position is segment center)
    const segmentPos = new THREE.Vector3(position[0], position[1], position[2]);
    const distance = segmentPos.distanceTo(new THREE.Vector3(raftPos.x, raftPos.y, raftPos.z));

    // Only push if raft is close to this water segment (within ~20 units)
    if (distance < 20) {
      const now = performance.now();
      // Apply force every 100ms to avoid over-applying
      if (now - lastPushTime.current > 100) {
        lastPushTime.current = now;
        
        // Current force: down + forward
        // Y: -0.5 pulls raft down onto water surface
        // Z: -4 pushes raft forward (downstream)
        const force = {
          x: 0,
          y: -0.5,
          z: -4 * flowSpeed
        };
        
        raftRef.current.applyImpulse(force, true);
      }
    }
  });

  return null; // invisible helper
};

export default WaterFlowForce;
