import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';

export default function Pebbles({ transforms, material }) {
  // Use low-poly geometry for performance
  // Radius 0.2, detail 0 (Icosahedron)
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(0.2, 0), []);

  // Fallback material if none provided (though we expect rockMaterial)
  const defaultMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#555555' }), []);

  const instances = useMemo(() => {
    if (!transforms) return [];
    return transforms.map((t, i) => ({
      key: `pebble-${i}`,
      position: t.position,
      rotation: t.rotation,
      scale: t.scale,
    }));
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <Instances range={instances.length} geometry={geometry} material={material || defaultMaterial} castShadow receiveShadow>
      {instances.map((data) => (
        <Instance
          key={data.key}
          position={data.position}
          rotation={data.rotation}
          scale={data.scale}
        />
      ))}
    </Instances>
  );
}
