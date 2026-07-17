// IceSheets.jsx — translucent shelf slabs at the waterline (glacial biomes).
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';

const SHEET_GEO = (() => {
  const geo = new THREE.BoxGeometry(1, 0.12, 0.6);
  geo.translate(0, 0.06, 0);
  return geo;
})();

const SHEET_MAT = new THREE.MeshPhysicalMaterial({
  color: '#e8f8ff',
  emissive: '#5088a8',
  emissiveIntensity: 0.08,
  metalness: 0.0,
  roughness: 0.08,
  transmission: 0.55,
  thickness: 0.4,
  transparent: true,
  opacity: 0.75,
  side: THREE.DoubleSide,
});

export default function IceSheets({ transforms }) {
  const instances = useMemo(() => {
    if (!transforms?.length) return [];
    return transforms.map((t, i) => ({
      key: `ice-sheet-${i}`,
      position: t.position,
      rotation: t.rotation ?? new THREE.Euler(0, 0, 0),
      scale: t.scale ?? new THREE.Vector3(1, 1, 1),
    }));
  }, [transforms]);

  if (instances.length === 0) return null;

  return (
    <Instances geometry={SHEET_GEO} material={SHEET_MAT} limit={instances.length} castShadow={false}>
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
