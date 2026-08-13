// Icicles — instanced hanging ice spikes along canyon rim (glacial biomes).
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import type { BiomeDecorationProps } from './types';

const ICICLE_GEO = (() => {
  const geo = new THREE.ConeGeometry(0.08, 1.0, 5);
  geo.translate(0, -0.5, 0);
  return geo;
})();

const ICE_MAT = new THREE.MeshStandardMaterial({
  color: '#d8f0ff',
  emissive: '#406878',
  emissiveIntensity: 0.15,
  metalness: 0.05,
  roughness: 0.15,
  transparent: true,
  opacity: 0.88,
});

interface IcicleInstance {
  key: string;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

export default function Icicles({ transforms }: BiomeDecorationProps) {
  const instances = useMemo((): IcicleInstance[] => {
    if (!transforms?.length) return [];
    return transforms.map((t, i) => ({
      key: `icicle-${i}`,
      position: t.position,
      rotation: t.rotation ?? new THREE.Euler(0, 0, 0),
      scale: t.scale ?? new THREE.Vector3(1, 1, 1),
    }));
  }, [transforms]);

  if (instances.length === 0) return null;

  return (
    <Instances geometry={ICICLE_GEO} material={ICE_MAT} limit={instances.length} castShadow={false}>
      {instances.map((item) => (
        <Instance
          key={item.key}
          position={item.position}
          rotation={item.rotation}
          scale={item.scale}
        />
      ))}
    </Instances>
  );
}
