import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import { useDriftwoodAssets } from './DebrisAssets';
import { extendRiverMaterial, updateRiverMaterial } from '../../utils/RiverShader';

export default function Driftwood({ transforms }) {
  const { geometry, material: baseMaterial } = useDriftwoodAssets();

  const material = useMemo(
    () => extendRiverMaterial(baseMaterial, { enableMoss: false }),
    [baseMaterial]
  );

  useFrame((state) => {
    updateRiverMaterial(material, state.clock.elapsedTime);
  });

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
