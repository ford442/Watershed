import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { InstancedRigidBodies } from '@react-three/rapier';
import { useTreeAssets } from './TreeAssets';
import { useFrame, useThree } from '@react-three/fiber';

// Color Palettes
const PALETTES = {
  summer: ['#2d4c1e', '#228b22', '#556b2f', '#1e3312'],
  autumn: ['#d35400', '#e67e22', '#f1c40f', '#c0392b', '#8e44ad', '#dbc632']
};

const RIM_PALETTES = {
  summer: ['#1c2518', '#1f2b1b', '#233321'],
  autumn: ['#2a1e17', '#33261e', '#3d3027'],
  slotCanyon: ['#1a1714', '#211d19', '#27221e'],
};

export default function Vegetation({ transforms, biome = 'summer', isRim = false }) {
  const { trunkGeometry, foliageGeometry } = useTreeAssets();
  const foliageRef = useRef(null);
  const rimBillboardRef = useRef(null);
  const { camera } = useThree();
  const safeTransforms = Array.isArray(transforms) ? transforms : [];

  // Materials
  const trunkMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#4a3a2e',    // Slightly warmer bark tone
      roughness: 0.92,
      metalness: 0
    });
    return mat;
  }, []);

  const foliageMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff', // Use white so instance color tints it correctly
      roughness: 0.82,
      metalness: 0
    });
    return mat;
  }, []);



  const instances = useMemo(() => {
    // Select palette based on biome, default to summer if invalid
    const palette = isRim
      ? (biome === 'slotCanyon' ? RIM_PALETTES.slotCanyon : (RIM_PALETTES[biome] || RIM_PALETTES.summer))
      : (PALETTES[biome] || PALETTES.summer);

    return safeTransforms.map((t, i) => {
      const colorHex = palette[i % palette.length];
      const color = new THREE.Color(colorHex);

      // Add slight brightness variation
      const shade = 0.82 + ((i * 37) % 19) / 100;
      color.multiplyScalar(shade);

      return {
        key: `veg-${i}`,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
        color: color
      };
    });
  }, [safeTransforms, biome, isRim]);

  const rimGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1.8, 1, 3);
    const positions = geo.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);
      const yNorm = (vertex.y + 0.9) / 1.8;
      const taper = 1.0 - yNorm * 0.55;
      positions.setXYZ(i, vertex.x * taper, vertex.y + 0.9, vertex.z);
    }
    positions.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, []);

  const rimMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: biome === 'slotCanyon' ? '#1e1a16' : '#23211d',
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  }, [biome]);

  // Tree sway animation
  useFrame((state) => {
    if (isRim) {
      if (!rimBillboardRef.current) return;
      rimBillboardRef.current.quaternion.copy(camera.quaternion);
      return;
    }
    if (!foliageRef.current) return;
    foliageRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.5) * 0.04;
  });

  if (safeTransforms.length === 0) return null;

  if (isRim) {
    return (
      <group ref={rimBillboardRef}>
        <Instances
          range={instances.length}
          geometry={rimGeometry}
          material={rimMaterial}
          castShadow
          receiveShadow={false}
        >
          {instances.map((t) => (
            <Instance
              key={t.key}
              position={t.position}
              scale={t.scale}
              color={t.color}
            />
          ))}
        </Instances>
      </group>
    );
  }

  return (
    <group>
      {/* TRUNKS */}
      <InstancedRigidBodies
        instances={instances}
        type="fixed"
        colliders={false}
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
