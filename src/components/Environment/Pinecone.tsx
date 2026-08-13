import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import { usePineconeAssets } from './DebrisAssets';
import {
  createRiverSurfaceMaterial,
  updateRiverSurfaceMaterial,
} from '../../materials/river/createRiverSurfaceMaterial';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import type { PlacementTransform } from '../TrackSegment/types';
import { extendRiverMaterial, updateRiverMaterial } from '../../utils/RiverShader';
import type { BiomeDecorationProps } from './types';

const DEFAULT_ROTATION = new THREE.Euler();
const DEFAULT_SCALE = new THREE.Vector3(1, 1, 1);

export default function Pinecone({ transforms }: BiomeDecorationProps) {
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
          rotation={t.rotation ?? DEFAULT_ROTATION}
          scale={t.scale ?? DEFAULT_SCALE}
          castShadow
          receiveShadow
        />
      ))}
    </Instances>
  );
}
