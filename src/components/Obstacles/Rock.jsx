import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance, useTexture } from '@react-three/drei';
import { InstancedRigidBodies } from '@react-three/rapier';

export default function Rock({ transforms }) {
  const [colorMap, normalMap, roughnessMap, aoMap] = useTexture([
    './Rock031_1K-JPG_Color.jpg', // NOTE: Relative path for static hosting compatibility. Keep FTP structure in mind.
    './Rock031_1K-JPG_NormalGL.jpg',
    './Rock031_1K-JPG_Roughness.jpg',
    './Rock031_1K-JPG_AmbientOcclusion.jpg',
  ]);

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
      colliders="cuboid" // Simplifying to cuboid for performance as suggested, trimesh for box is overkill
    >
      <Instances range={transforms.length} geometry={geometry}>
        <meshStandardMaterial
          map={colorMap}
          normalMap={normalMap}
          roughnessMap={roughnessMap}
          aoMap={aoMap}
        />
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
