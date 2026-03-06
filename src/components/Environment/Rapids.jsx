import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function Rapids({ transforms, flowSpeed = 1.0 }) {
  const meshRef = useRef();

  // Low poly "foam pile" geometry
  // Detail 0 Icosahedron is chunky and looks like stylized foam
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(0.3, 0), []);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#e8f4f8',       // Slightly blue-tinted white foam
      roughness: 0.4,         // Wet/shiny foam
      metalness: 0,
      transparent: true,
      opacity: 0.85,
    });
    return mat;
  }, [flowSpeed]);

  // Setup Instances
  useEffect(() => {
    if (!meshRef.current || !transforms || transforms.length === 0) return;

    const mesh = meshRef.current;

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.copy(t.rotation);
      DUMMY_OBJ.scale.copy(t.scale);
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
