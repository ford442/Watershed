import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

const hash = (n) => {
  const x = Math.sin(n * 9.173) * 43758.5453;
  return x - Math.floor(x);
};

export default function CanyonGrass({ transforms }) {
  const grassRef = useRef(null);
  const safeTransforms = Array.isArray(transforms) ? transforms : [];

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(0.08, 0.65, 1, 3);
    geo.translate(0, 0.32, 0);
    return geo;
  }, []);

  const material = useMemo(() => (
    new THREE.MeshStandardMaterial({
      color: '#c8a86e',
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  ), []);

  const instances = useMemo(() => safeTransforms.map((transform, index) => {
    const position = transform.position;
    const seed = position.x * 0.43 + position.z * 0.29 + index * 1.33;
    const yaw = transform.rotation.y + (hash(seed + 0.7) - 0.5) * 0.4;
    const lean = (hash(seed + 1.4) - 0.5) * 0.35;
    return {
      key: `canyon-grass-${index}`,
      position,
      rotation: new THREE.Euler(lean, yaw, (hash(seed + 2.1) - 0.5) * 0.12),
      scale: new THREE.Vector3(
        transform.scale.x * (0.85 + hash(seed + 2.9) * 0.35),
        transform.scale.y * (0.9 + hash(seed + 3.6) * 0.6),
        transform.scale.z
      ),
      color: new THREE.Color('#c8a86e').multiplyScalar(0.82 + hash(seed + 4.2) * 0.25),
    };
  }), [safeTransforms]);

  useFrame((state) => {
    if (!grassRef.current) return;
    const t = state.clock.getElapsedTime();
    grassRef.current.rotation.z = Math.sin(t * 1.6) * 0.02;
    grassRef.current.rotation.x = Math.cos(t * 1.3) * 0.01;
  });

  if (!instances.length) return null;

  return (
    <Instances ref={grassRef} geometry={geometry} material={material} range={instances.length} receiveShadow>
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
