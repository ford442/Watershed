import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { InstancedRigidBodies } from '@react-three/rapier';
import { useTreeAssets } from './TreeAssets';
import { useFrame } from '@react-three/fiber';

// Color Palettes
const PALETTES = {
  summer: ['#2d4c1e', '#228b22', '#556b2f', '#1e3312'],
  autumn: ['#d35400', '#e67e22', '#f1c40f', '#c0392b', '#8e44ad', '#dbc632']
};

export default function Vegetation({ transforms, biome = 'summer' }) {
  const { trunkGeometry, foliageGeometry } = useTreeAssets();
  const foliageRef = useRef(null);

  // Materials
  const trunkMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#4a3c31',
      roughness: 0.9,
      metalness: 0
    });
    return mat;
  }, []);

  const foliageMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff', // Use white so instance color tints it correctly
      roughness: 0.8,
      metalness: 0
    });
    return mat;
  }, []);



  const instances = useMemo(() => {
    // Select palette based on biome, default to summer if invalid
    const palette = PALETTES[biome] || PALETTES.summer;

    return transforms.map((t, i) => {
      // Pick a random color from the palette
      const colorHex = palette[Math.floor(Math.random() * palette.length)];
      const color = new THREE.Color(colorHex);

      // Add slight brightness variation
      const shade = 0.8 + Math.random() * 0.4;
      color.multiplyScalar(shade);

      return {
        key: `veg-${i}`,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
        color: color
      };
    });
  }, [transforms, biome]);

  // Tree sway animation
  useFrame((state) => {
    if (!foliageRef.current) return;
    // Gentle wind sway - stronger like original deployed version
    foliageRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.5) * 0.04;
  });

  if (!transforms || transforms.length === 0) return null;

  return (
    <group>
      {/* TRUNKS */}
      <InstancedRigidBodies
        instances={instances}
        type="fixed"
        colliders="hull"
      >
        <Instances range={instances.length} geometry={trunkGeometry} material={trunkMaterial} castShadow receiveShadow>
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

      {/* FOLIAGE */}
      <Instances ref={foliageRef} range={instances.length} geometry={foliageGeometry} material={foliageMaterial} castShadow receiveShadow>
        {instances.map((t) => (
          <Instance
            key={t.key}
            position={t.position}
            rotation={t.rotation}
            scale={t.scale}
            color={t.color}
          />
        ))}
      </Instances>
    </group>
  );
}
