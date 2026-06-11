import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { extendVegetationMaterial, updateVegetationMaterial } from '../../utils/VegetationShader';

const DUMMY_OBJ = new THREE.Object3D();
const PAD_COLOR = new THREE.Color('#3a8c40');
const VEIN_COLOR = new THREE.Color('#2a6630');
const RIM_COLOR = new THREE.Color('#4fae54');

export default function WaterLilies({ transforms }) {
  const meshRef = useRef();

  // Geometry: Lily pad disc with radial venation + lighter rim, baked as vertex colors
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

      // Radial veins: darker streaks at regular angular intervals, fading toward center
      const veinPattern = Math.pow(Math.abs(Math.cos(angle * (segments / 2))), 8);
      const veinStrength = veinPattern * THREE.MathUtils.smoothstep(radius, 0.05, 0.35);

      // Lighter rim toward the pad's outer edge
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
    // Gentle independent bob/drift per pad, as if resting on tiny ripples
    extendVegetationMaterial(mat, { windStrength: 0.035, windSpeed: 1.0, mode: 'bob' });
    return mat;
  }, []);

  useFrame((state) => {
    updateVegetationMaterial(material, state.clock.elapsedTime);
  });

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
