import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { mergeBufferGeometries } from 'three-stdlib';

const DUMMY_OBJ = new THREE.Object3D();

export default function Dragonflies({ transforms }) {
  const meshRef = useRef();

  // Procedural Dragonfly Geometry
  const geometry = useMemo(() => {
    const geometries = [];

    // 1. Body (Thin Cylinder)
    const bodyGeo = new THREE.CylinderGeometry(0.02, 0.01, 0.5, 6);
    bodyGeo.rotateX(Math.PI / 2); // Align with Z axis (forward)
    geometries.push(bodyGeo);

    // 2. Head (Small Sphere)
    const headGeo = new THREE.SphereGeometry(0.04, 8, 6);
    headGeo.translate(0, 0, 0.25); // Move to front
    geometries.push(headGeo);

    // 3. Wings (4 Planes)
    // Front Left
    const flWing = new THREE.PlaneGeometry(0.5, 0.12);
    flWing.translate(0.25, 0, 0); // Pivot at edge
    flWing.rotateX(-Math.PI / 2); // Flat
    flWing.rotateY(-0.2); // Angle back slightly
    flWing.translate(0, 0.02, 0.1); // Position on body
    geometries.push(flWing);

    // Front Right
    const frWing = new THREE.PlaneGeometry(0.5, 0.12);
    frWing.translate(0.25, 0, 0);
    frWing.rotateX(-Math.PI / 2);
    frWing.rotateY(-0.2);
    frWing.rotateZ(Math.PI); // Mirror
    frWing.translate(0, 0.02, 0.1);
    geometries.push(frWing);

    // Back Left
    const blWing = new THREE.PlaneGeometry(0.4, 0.1);
    blWing.translate(0.2, 0, 0);
    blWing.rotateX(-Math.PI / 2);
    blWing.rotateY(-0.1);
    blWing.translate(0, 0.02, -0.05);
    geometries.push(blWing);

    // Back Right
    const brWing = new THREE.PlaneGeometry(0.4, 0.1);
    brWing.translate(0.2, 0, 0);
    brWing.rotateX(-Math.PI / 2);
    brWing.rotateY(-0.1);
    brWing.rotateZ(Math.PI);
    brWing.translate(0, 0.02, -0.05);
    geometries.push(brWing);

    if (geometries.length === 0) return new THREE.BufferGeometry();

    const merged = mergeBufferGeometries(geometries);
    merged.computeVertexNormals();
    return merged;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: '#00cccc' // Cyan base
    });
    return mat;
  }, []);

  useEffect(() => {
    if (!meshRef.current || !transforms) return;
    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.copy(t.rotation || new THREE.Euler());
      DUMMY_OBJ.scale.copy(t.scale || new THREE.Vector3(1, 1, 1));
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
      frustumCulled={false} // Movement pushes them out of bounds
    />
  );
}
