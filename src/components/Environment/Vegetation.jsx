import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { InstancedRigidBodies } from '@react-three/rapier';
import { useTreeAssets } from './TreeAssets';

export default function Vegetation({ transforms }) {
  const { trunkGeometry, foliageGeometry } = useTreeAssets();

  // Materials
  const trunkMaterial = useMemo(() =>
    new THREE.MeshStandardMaterial({
      color: '#4a3c31',
      roughness: 0.9
    }), []
  );

  const foliageMaterial = useMemo(() =>
    new THREE.MeshStandardMaterial({
      color: '#2d4c1e',
      roughness: 0.8,
      flatShading: true // Low-poly look
    }), []
  );

  const instances = useMemo(() => {
    return transforms.map((t, i) => {
      // Add random color variation to foliage
      // We can't easily change material per instance efficiently without custom shader or Instance color prop.
      // <Instance> supports 'color' prop if the material uses vertex colors.
      // But standard material doesn't use vertex colors by default unless vertexColors={true}.
      // Let's stick to global material for now for max performance,
      // OR enable vertex colors.

      // Let's try simple color variation using Instance color prop.
      // We need to clone the material and set vertexColors: true if we want it.
      // But @react-three/drei Instances usually handles this.

      const shade = 0.8 + Math.random() * 0.4; // 0.8 to 1.2 brightness
      const color = new THREE.Color('#2d4c1e').multiplyScalar(shade);

      return {
        key: `veg-${i}`,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
        color: color
      };
    });
  }, [transforms]);

  if (transforms.length === 0) return null;

  return (
    <group>
      {/* TRUNKS (Physics + Visuals) */}
      <InstancedRigidBodies
        instances={instances}
        type="fixed"
        colliders="hull" // Hull of the cylinder
      >
        <Instances range={instances.length} geometry={trunkGeometry} material={trunkMaterial}>
          {instances.map((t) => (
            <Instance
              key={t.key}
              position={t.position}
              rotation={t.rotation}
              scale={t.scale}
            />
          ))}
        </Instances>
      </InstancedRigidBodies>

      {/* FOLIAGE (Visuals Only - No Physics) */}
      {/* We reuse the same transforms */}
      <Instances range={instances.length} geometry={foliageGeometry} material={foliageMaterial}>
        {instances.map((t) => (
          <Instance
            key={t.key}
            position={t.position}
            rotation={t.rotation}
            scale={t.scale}
            color={t.color} // Apply color variation
          />
        ))}
      </Instances>
    </group>
  );
}
