import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

export default function Grass({ transforms }) {
  const grassRef = useRef(null);
  
  // Geometry: Low poly bush (Icosahedron)
  const geometry = useMemo(() => {
    // Create a slightly irregular bush shape by merging 2 shapes or just one
    // Simple low-poly sphere (Icosahedron with detail 0)
    const geo = new THREE.IcosahedronGeometry(1, 0);

    // Squish it a bit to be more bush-like (wider than tall)
    geo.scale(1, 0.7, 1);

    // Move base to origin so it sits on the ground
    geo.translate(0, 0.5, 0);

    geo.computeVertexNormals();
    return geo;
  }, []);

  // Material: Stylized green
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
        color: '#5a7d38', // Muted organic green
        roughness: 0.9,
        metalness: 0
    });
    return mat;
  }, []);

  const instances = useMemo(() => {
    if (!transforms) return [];
    return transforms.map((t, i) => {
        // Random shade variation per bush
        const shade = 0.8 + Math.random() * 0.4;
        const color = new THREE.Color('#5a7d38').multiplyScalar(shade);
        return {
            key: `grass-${i}`,
            position: t.position,
            rotation: t.rotation,
            scale: t.scale,
            color
        };
    });
  }, [transforms]);

  // Grass sway animation
  useFrame((state) => {
    if (grassRef.current) {
      const time = state.clock.getElapsedTime();
      // Subtle grass movement
      grassRef.current.rotation.z = Math.sin(time * 2) * 0.01;
      grassRef.current.rotation.x = Math.cos(time * 1.8) * 0.008;
    }
  });

  if (!transforms || transforms.length === 0) return null;

  return (
    <Instances ref={grassRef} range={instances.length} geometry={geometry} material={material} receiveShadow>
      {instances.map((data) => (
        <Instance
          key={data.key}
          position={data.position}
          rotation={data.rotation}
          scale={data.scale}
          color={data.color}
        />
      ))}
    </Instances>
  );
}
