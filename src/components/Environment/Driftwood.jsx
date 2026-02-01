import React, { useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import { useDriftwoodAssets } from './DebrisAssets';

export default function Driftwood({ transforms }) {
  const { geometry, material } = useDriftwoodAssets();

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
