import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { createVegetationSurfaceMaterial, updateVegetationSurfaceMaterial } from '../../materials/foliage/createFoliageSurfaceMaterial';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import type { BiomeDecorationProps } from './types';

const DUMMY_OBJ = new THREE.Object3D();
const PAD_COLOR = new THREE.Color('#3a8c40');
const VEIN_COLOR = new THREE.Color('#2a6630');
const RIM_COLOR = new THREE.Color('#4fae54');
const DEFAULT_ROTATION = new THREE.Euler();

export default function WaterLilies({ transforms }: BiomeDecorationProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => {
    const segments = 12;
    const geo = new THREE.CylinderGeometry(0.4, 0.4, 0.02, segments);
    geo.translate(0, 0.01, 0);

    const positions = geo.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const radius = Math.sqrt(x * x + z * z);
      const angle = Math.atan2(z, x);

      const veinPattern = Math.pow(Math.abs(Math.cos(angle * (segments / 2))), 8);
      const veinStrength = veinPattern * THREE.MathUtils.smoothstep(radius, 0.05, 0.35);
      const rimStrength = THREE.MathUtils.smoothstep(radius, 0.3, 0.4);

      c.copy(PAD_COLOR).lerp(VEIN_COLOR, veinStrength * 0.6).lerp(RIM_COLOR, rimStrength * 0.5);

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.75,
      metalness: 0.0,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    return createVegetationSurfaceMaterial(resolveMaterialBackend().backend, mat, { windStrength: 0.035, windSpeed: 1.0, mode: 'bob' });
  }, []);

  useFrame((state) => {
    updateVegetationSurfaceMaterial(material, state.clock.elapsedTime);
  });

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !transforms) return;

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.copy(t.rotation ?? DEFAULT_ROTATION);

      const scale = t.scale ? t.scale.x : 1.0;
      DUMMY_OBJ.scale.setScalar(scale);

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
      castShadow
      receiveShadow
    />
  );
}
