import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import { usePineconeAssets } from './DebrisAssets';
import { extendRiverMaterial } from '../../utils/RiverShader';

/**
 * Pinecone - Realistic pinecone geometry for creek environment
 * Creates a simple but recognizable pinecone shape using cones and spheres
 * 
 * @param {Array} transforms - Array of {position, rotation, scale} objects
 */
export default function Pinecone({ transforms }) {
  const { geometry, material } = usePineconeAssets();

  useMemo(() => {
    extendRiverMaterial(material);
  }, [material]);

  useFrame((state) => {
    if (material.userData.shader) {
      material.userData.shader.uniforms.time.value = state.clock.elapsedTime;
    }
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
