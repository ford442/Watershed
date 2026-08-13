import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { BiomeId } from '../../configs/biomes';
import type { FallingLeavesProps } from './types';

const LEAF_PALETTES: Record<string, string[]> = {
  summer: ['#4a6b2f', '#6b8c42', '#3d5229', '#8f9e58'],
  autumn: ['#d35400', '#e67e22', '#f1c40f', '#c0392b', '#a04000'],
  canyonSummer: ['#4a6b2f', '#6b8c42', '#3d5229', '#8f9e58'],
  canyonAutumn: ['#d35400', '#e67e22', '#f1c40f', '#c0392b', '#a04000'],
};

const DUMMY_OBJ = new THREE.Object3D();
const DEFAULT_SCALE = new THREE.Vector3(1, 1, 1);

function resolvePalette(biome: BiomeId | string | undefined): string[] {
  if (biome && LEAF_PALETTES[biome]) return LEAF_PALETTES[biome];
  if (biome && String(biome).includes('autumn')) return LEAF_PALETTES.autumn;
  return LEAF_PALETTES.summer;
}

export default function FallingLeaves({
  transforms,
  biome = 'canyonSummer',
  floating = false,
}: FallingLeavesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(0.3, 0.3);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI / 4);
    return geo;
  }, []);

  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), [floating]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !transforms || transforms.length === 0) return;

    const palette = resolvePalette(biome);
    const color = new THREE.Color();

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.set(0, t.rotation?.y ?? 0, 0);
      DUMMY_OBJ.scale.copy(t.scale ?? DEFAULT_SCALE);
      DUMMY_OBJ.updateMatrix();

      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);

      const hex = palette[Math.floor(Math.random() * palette.length)] ?? palette[0];
      color.set(hex);
      color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);

      mesh.setColorAt(i, color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [transforms, biome]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, transforms.length]}
      castShadow
      receiveShadow
    />
  );
}
