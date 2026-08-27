import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RainbowProps } from './types';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import { createRainbowMaterial } from '../../materials/vfx/createVfxMaterials';
import { materialUniformBag } from '../../materials/dual/materialUniformBag';

export default function Rainbow({
  opacity = 0.4,
  sunDirection = new THREE.Vector3(0.1, 1.0, 0.1),
}: RainbowProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => new THREE.TorusGeometry(8, 0.55, 8, 64, Math.PI), []);

  const material = useMemo(
    () =>
      createRainbowMaterial(resolveMaterialBackend().backend, {
        opacity,
        sunDirection,
      }),
    [opacity, sunDirection],
  );

  useFrame((state) => {
    const mat = meshRef.current?.material;
    const u = materialUniformBag(mat);
    if (!u) return;
    if (u.time) u.time.value = state.clock.elapsedTime;
    if (u.opacity) u.opacity.value = opacity;
    if (u.sunDirection?.value && typeof (u.sunDirection.value as THREE.Vector3).copy === 'function') {
      (u.sunDirection.value as THREE.Vector3).copy(sunDirection).normalize();
    }
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}
