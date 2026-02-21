import React, { useMemo } from 'react';
import * as THREE from 'three';
import { InstancedRigidBodies } from '@react-three/rapier';

// Simplified Rock - no MeshStandardMaterial to avoid shader errors
export default function Rock({ transforms }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  // Memoize instances data for InstancedRigidBodies
  const instances = useMemo(() => {
    return transforms.map(t => ({
      key: `rock-${t.position.toArray().join('-')}`,
      position: t.position,
      rotation: t.rotation,
      scale: t.scale,
    }));
  }, [transforms]);

  if (transforms.length === 0) return null;

  return (
    <InstancedRigidBodies
      instances={instances}
      type="fixed"
      colliders="cuboid"
    >
      <instancedMesh args={[geometry, null, transforms.length]}>
        <meshBasicMaterial color={0x666666} />
      </instancedMesh>
    </InstancedRigidBodies>
  );
}
