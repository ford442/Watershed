import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

const BASE_COLORS = {
  default: '#4e7336',
  slotCanyon: '#c8a86e',
};

const hash = (n) => {
  const x = Math.sin(n * 7.531) * 43758.5453;
  return x - Math.floor(x);
};

export default function Grass({ transforms, biome = 'summer' }) {
  const grassRef = useRef(null);
  const baseColor = biome === 'slotCanyon' ? BASE_COLORS.slotCanyon : BASE_COLORS.default;
  
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
        color: baseColor,
        roughness: 0.88,
        metalness: 0
    });
    return mat;
  }, [baseColor]);

  const instances = useMemo(() => {
    if (!transforms) return [];
    return transforms.map((t, i) => {
        const seed = t.position.x * 0.31 + t.position.z * 0.19 + i * 1.17;
        const shade = 0.8 + hash(seed) * 0.4;
        const color = new THREE.Color(baseColor).multiplyScalar(shade);
        return {
            key: `grass-${i}`,
            position: t.position,
            rotation: t.rotation,
            scale: t.scale,
            color
        };
    });
  }, [baseColor, transforms]);

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
