import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { InstancedRigidBodies } from '@react-three/rapier';

export default function Vegetation({ transforms }) {
  // Simple low-poly cone for tree
  const geometry = useMemo(() => new THREE.ConeGeometry(1, 4, 8), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2d4c1e' }), []);

  const instances = useMemo(() => {
    return transforms.map(t => ({
      key: `veg-${t.position.toArray().join('-')}`,
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
      colliders="hull"
    >
      <Instances range={transforms.length} geometry={geometry} material={material}>
        {transforms.map((t, i) => (
          <Instance
            key={i}
            position={t.position}
            rotation={t.rotation}
            scale={t.scale}
          />
        ))}
      </Instances>
    </InstancedRigidBodies>
  );
}
