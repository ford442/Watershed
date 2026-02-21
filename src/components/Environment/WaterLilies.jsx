import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function WaterLilies({ transforms }) {
  const meshRef = useRef();

  // Geometry: Low Poly Lily Pad
  const geometry = useMemo(() => {
    // Flat cylinder for thickness
    const geo = new THREE.CylinderGeometry(0.4, 0.4, 0.02, 7);

    // Adjust pivot to be at the bottom/center
    geo.translate(0, 0.01, 0);

    geo.computeVertexNormals();
    return geo;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: '#4caf50' // Nature Green
    });
    return mat;
  }, []);

  useEffect(() => {
    if (!meshRef.current || !transforms) return;

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.copy(t.rotation);

      const scale = t.scale ? t.scale.x : 1.0;
      DUMMY_OBJ.scale.setScalar(scale);

      DUMMY_OBJ.updateMatrix();
      meshRef.current.setMatrixAt(i, DUMMY_OBJ.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, transforms.length]}
      frustumCulled={false}
      castShadow
      receiveShadow
    />
  );
}
