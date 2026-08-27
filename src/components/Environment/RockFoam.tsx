import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';
import type { BiomeDecorationProps } from './types';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import { createRockFoamMaterial } from '../../materials/vfx/createVfxMaterials';
import { materialUniformBag } from '../../materials/dual/materialUniformBag';

const DEFAULT_ROTATION = new THREE.Euler();
const DEFAULT_SCALE = new THREE.Vector3(1, 1, 1);

export default function RockFoam({ transforms, flowSpeed = 1.0 }: BiomeDecorationProps) {
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const material = useMemo(
    () =>
      createRockFoamMaterial(resolveMaterialBackend().backend, {
        flowSpeed,
        colorBase: new THREE.Color('#d8f0f4'),
      }),
    [flowSpeed],
  );

  useFrame((state) => {
    const u = materialUniformBag(material);
    if (u?.time) u.time.value = state.clock.elapsedTime;
  });

  if (!transforms || transforms.length === 0) return null;

  return (
    <Instances geometry={geometry} material={material}>
      {transforms.map((t, i) => (
        <Instance
          key={i}
          position={t.position}
          rotation={t.rotation ?? DEFAULT_ROTATION}
          scale={t.scale ?? DEFAULT_SCALE}
        />
      ))}
    </Instances>
  );
}
