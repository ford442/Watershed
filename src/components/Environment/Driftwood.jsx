import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';

export default function Driftwood({ transforms }) {
  // Geometry: Low poly log (Cylinder with low radial segments)
  const geometry = useMemo(() => {
    // Top radius 0.15, bottom 0.25, length 4, 5 segments
    const geo = new THREE.CylinderGeometry(0.15, 0.25, 4, 5);
    geo.rotateZ(Math.PI / 2); // Lay flat (along X axis initially)
    // Add some random noise to vertices? Can't do easily in useMemo without a seeded random or complexity.
    // Keeping it simple low-poly.

    geo.computeVertexNormals();
    return geo;
  }, []);

  // Material: Bleached wood
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#8c8c7a', // Greyish brown (bleached wood)
    roughness: 0.9,
    flatShading: true,
  }), []);

  const instances = useMemo(() => {
    if (!transforms) return [];
    return transforms.map((t, i) => {
        return {
            key: `driftwood-${i}`,
            position: t.position,
            rotation: t.rotation,
            scale: t.scale,
        };
    });
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <Instances range={instances.length} geometry={geometry} material={material}>
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
