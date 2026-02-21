import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';

const LEAF_PALETTES = {
  summer: ['#4a6b2f', '#6b8c42', '#3d5229', '#8f9e58'],
  autumn: ['#d35400', '#e67e22', '#f1c40f', '#c0392b', '#a04000']
};

const DUMMY_OBJ = new THREE.Object3D();

export default function FallingLeaves({ transforms, biome = 'summer', floating = false }) {
  const meshRef = useRef();

  // Create a simple leaf geometry (low poly diamond shape)
  const geometry = useMemo(() => {
    // PlaneGeometry(width, height, widthSegments, heightSegments)
    const geo = new THREE.PlaneGeometry(0.3, 0.3);
    geo.rotateX(-Math.PI / 2); // Flat on ground initially
    geo.rotateY(Math.PI / 4);  // Rotate to diamond
    return geo;
  }, []);

  // Custom Shader Material
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: '#ffffff'
    });
    return mat;
  }, [floating]);

  // Setup Instances
  useEffect(() => {
    if (!meshRef.current || !transforms || transforms.length === 0) return;

    const mesh = meshRef.current;
    const palette = LEAF_PALETTES[biome] || LEAF_PALETTES.summer;
    const color = new THREE.Color();

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      // For floating leaves, we might want flat rotation, but FallingLeaves shader handles rotation.
      // We pass the base transform.
      DUMMY_OBJ.rotation.set(0, t.rotation.y, 0);
      DUMMY_OBJ.scale.copy(t.scale || new THREE.Vector3(1,1,1));
      DUMMY_OBJ.updateMatrix();

      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);

      // Random color from palette
      const hex = palette[Math.floor(Math.random() * palette.length)];
      color.set(hex);
      // Variation
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
