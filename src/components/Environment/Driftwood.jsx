import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { mergeBufferGeometries } from 'three-stdlib';

export default function Driftwood({ transforms }) {
  // Geometry: Complex Dead Tree Branch
  const geometry = useMemo(() => {
    const geos = [];

    // 1. Main Trunk Log
    // Radius varies slightly (Cone-ish cylinder)
    // Radius top 0.12, bottom 0.22, length 4.5
    const mainLog = new THREE.CylinderGeometry(0.12, 0.22, 4.5, 6);
    mainLog.rotateZ(Math.PI / 2 + 0.1); // Lay flat, slight tilt
    // Slight curve simulation by rotating geometry around center?
    // Hard with just primitive. Let's stick to composite.
    geos.push(mainLog);

    // 2. Branch 1 (Sticking out)
    const branch1 = new THREE.CylinderGeometry(0.08, 0.12, 1.5, 5);
    branch1.rotateZ(Math.PI / 4); // 45 degrees
    branch1.rotateY(0.5);
    branch1.translate(1.0, 0.5, 0.2); // Position along main log
    geos.push(branch1);

    // 3. Branch 2 (Broken stub)
    const branch2 = new THREE.CylinderGeometry(0.05, 0.1, 0.8, 5);
    branch2.rotateZ(-Math.PI / 3);
    branch2.translate(-1.2, 0.3, -0.1);
    geos.push(branch2);

    const merged = mergeBufferGeometries(geos);
    merged.computeVertexNormals();
    return merged;
  }, []);

  // Material: Bleached wood
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#8c8c7a', // Greyish brown (bleached wood)
    roughness: 1.0,
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
