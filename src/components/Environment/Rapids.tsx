import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { BiomeDecorationProps, BiomeDecorationTransform } from './types';

const DUMMY_OBJ = new THREE.Object3D();
const DEFAULT_ROTATION = new THREE.Euler();
const DEFAULT_SCALE = new THREE.Vector3(1, 1, 1);

export default function Rapids({ transforms, flowSpeed = 1.0 }: BiomeDecorationProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(0.3, 0), []);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#e8f4f8',
      roughness: 0.4,
      metalness: 0,
      transparent: true,
      opacity: 0.85,
    });
    return mat;
  }, [flowSpeed]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !transforms || transforms.length === 0) return;

    transforms.forEach((t: BiomeDecorationTransform, i: number) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.copy(t.rotation ?? DEFAULT_ROTATION);
      DUMMY_OBJ.scale.copy(t.scale ?? DEFAULT_SCALE);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, transforms.length]}
      frustumCulled={false}
    />
  );
}
