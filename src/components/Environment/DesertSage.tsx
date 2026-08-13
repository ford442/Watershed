import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import type { BiomeDecorationProps } from './types';

const hash = (n: number): number => {
  const x = Math.sin(n * 18.233) * 43758.5453;
  return x - Math.floor(x);
};

export default function DesertSage({ transforms }: BiomeDecorationProps) {
  const safeTransforms = Array.isArray(transforms) ? transforms : [];

  const geometry = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(0.3, 0);
    geo.scale(1.25, 0.9, 1.15);
    geo.translate(0, 0.24, 0);
    geo.computeVertexNormals();
    return geo;
  }, []);

  const material = useMemo(() => (
    new THREE.MeshStandardMaterial({
      color: '#8fa89f',
      roughness: 0.95,
      metalness: 0,
    })
  ), []);

  const instances = useMemo(() => safeTransforms.map((transform, index) => {
    const position = transform.position;
    const rotation = transform.rotation ?? new THREE.Euler();
    const scale = transform.scale ?? new THREE.Vector3(1, 1, 1);
    const seed = position.x * 0.21 + position.z * 0.37 + index * 2.13;
    const scaleJitter = 0.85 + hash(seed + 0.9) * 0.45;
    return {
      key: `sage-${index}`,
      position,
      rotation,
      scale: new THREE.Vector3(
        scale.x * (0.95 + hash(seed + 1.7) * 0.35),
        scale.y * scaleJitter,
        scale.z * (0.95 + hash(seed + 2.5) * 0.35),
      ),
      color: new THREE.Color('#8fa89f').multiplyScalar(0.85 + hash(seed + 3.1) * 0.25),
    };
  }), [safeTransforms]);

  if (!instances.length) return null;

  return (
    <Instances geometry={geometry} material={material} castShadow receiveShadow>
      {instances.map((item) => (
        <Instance
          key={item.key}
          position={item.position}
          rotation={item.rotation}
          scale={item.scale}
          color={item.color}
        />
      ))}
    </Instances>
  );
}
