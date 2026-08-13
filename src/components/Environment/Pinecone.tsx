import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import { usePineconeAssets } from './DebrisAssets';
import {
  createRiverSurfaceMaterial,
  updateRiverSurfaceMaterial,
} from '../../materials/river/createRiverSurfaceMaterial';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import type { PlacementTransform } from '../TrackSegment/types';

interface PineconeProps {
  transforms?: PlacementTransform[];
}

/**
 * Pinecone - Realistic pinecone geometry for creek environment
 * Creates a simple but recognizable pinecone shape using cones and spheres
 */
export default function Pinecone({ transforms }: PineconeProps) {
  const { geometry, material: baseMaterial } = usePineconeAssets();

  const material = useMemo(
    () => createRiverSurfaceMaterial(resolveMaterialBackend().backend, baseMaterial, { enableMoss: false }),
    [baseMaterial]
  );

  useFrame((state) => {
    updateRiverSurfaceMaterial(material, state.clock.elapsedTime);
  });

  if (!transforms || transforms.length === 0) return null;

  return (
    <Instances range={transforms.length} geometry={geometry} material={material}>
      {transforms.map((t, i) => (
        <Instance
          key={i}
          position={t.position}
          rotation={t.rotation}
          scale={t.scale}
          castShadow
          receiveShadow
        />
      ))}
    </Instances>
  );
}
