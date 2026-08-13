import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';
import { useDriftwoodAssets } from './DebrisAssets';
import { extendRiverMaterial, updateRiverMaterial } from '../../utils/RiverShader';
import type { BiomeDecorationProps } from './types';

const DEFAULT_ROTATION = new THREE.Euler();
const DEFAULT_SCALE = new THREE.Vector3(1, 1, 1);

interface DriftwoodInstance {
  key: string;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

export default function Driftwood({ transforms }: BiomeDecorationProps) {
  const { geometry, material: baseMaterial } = useDriftwoodAssets();

  const material = useMemo(
    () => extendRiverMaterial(baseMaterial, { enableMoss: false }),
    [baseMaterial]
  );

  useFrame((state) => {
    updateRiverMaterial(material, state.clock.elapsedTime);
  });

  const instances = useMemo((): DriftwoodInstance[] => {
    if (!transforms) return [];
    return transforms.map((t, i) => ({
      key: `driftwood-${i}`,
      position: t.position,
      rotation: t.rotation ?? DEFAULT_ROTATION,
      scale: t.scale ?? DEFAULT_SCALE,
    }));
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <Instances range={instances.length} geometry={geometry} material={material} castShadow receiveShadow>
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
