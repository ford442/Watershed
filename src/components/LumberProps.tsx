// src/components/LumberProps.tsx
// Wood debris, planks, logs, barrels for Lumber Flume biome

import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface LumberPropsProps {
  /** Array of positions for debris */
  positions: THREE.Vector3[];
  /** Type of lumber prop */
  type: 'plank' | 'log' | 'barrel';
}

/**
 * LumberProps — Floating wood debris for the flume biome
 * 
 * Simple instanced meshes for performance.
 * Props drift downstream with slight rotation.
 */
export const LumberProps: React.FC<LumberPropsProps> = ({
  positions,
  type,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Geometry based on type
  const geometry = useMemo(() => {
    switch (type) {
      case 'plank':
        return new THREE.BoxGeometry(2, 0.1, 0.4);
      case 'log':
        return new THREE.CylinderGeometry(0.15, 0.15, 2, 8);
      case 'barrel':
        return new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [type]);

  // Wood material
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: type === 'barrel' ? '#5c4033' : '#8b6f47',
      roughness: 0.8,
      metalness: 0.1,
    });
  }, [type]);

  // Animate drift
  useFrame((state) => {
    if (!meshRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    positions.forEach((pos, i) => {
      dummy.position.copy(pos);
      
      // Gentle bobbing
      dummy.position.y += Math.sin(time * 2 + i) * 0.05;
      
      // Rotation based on type
      if (type === 'log' || type === 'barrel') {
        dummy.rotation.set(
          Math.PI / 2 + Math.sin(time + i) * 0.1,
          Math.sin(time * 0.5 + i) * 0.2,
          Math.sin(time * 0.3 + i) * 0.1
        );
      } else {
        // Planks float flat-ish
        dummy.rotation.set(
          Math.sin(time * 0.5 + i) * 0.05,
          Math.sin(time * 0.3 + i) * 0.2,
          Math.sin(time * 0.4 + i) * 0.1
        );
      }
      
      // Slight downstream drift visual
      dummy.position.z += Math.sin(time * 0.5 + i * 0.5) * 0.02;
      
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (positions.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, positions.length]}
    />
  );
};

export default LumberProps;
