import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function Birds({ transforms, biome = 'summer' }) {
  const meshRef = useRef();

  // Simple Bird Geometry: Two triangles forming a V
  // Use useMemo to create it only once
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
       // Left Wing
       0.0, 0, 0.2,    // Body Center (Tail-ish)
       0.0, 0, -0.3,   // Head
       1.2, 0, 0.0,    // Left Wing Tip

       // Right Wing
       0.0, 0, 0.2,    // Body Center
       -1.2, 0, 0.0,   // Right Wing Tip
       0.0, 0, -0.3    // Head
    ]);

    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: '#eeeeee'
    });
    return mat;
  }, []);

  useEffect(() => {
     if (!meshRef.current || !transforms) return;
     transforms.forEach((t, i) => {
         DUMMY_OBJ.position.copy(t.position);
         DUMMY_OBJ.rotation.set(0,0,0);
         DUMMY_OBJ.scale.setScalar(1);
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
        frustumCulled={false} // Important: Birds move away from their bounding box
    />
  );
}
