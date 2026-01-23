import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
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
    const mat = new THREE.MeshStandardMaterial({
      color: '#4caf50', // Nature Green
      roughness: 0.3,
      metalness: 0.0,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = { value: 0 };
      shader.vertexShader = 'uniform float time;\n' + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>

        // Randomness
        float seed = dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 45.164));
        float rand = fract(sin(seed) * 43758.5453);

        // Bobbing Animation
        float bobSpeed = 1.0 + rand * 0.5;
        float bobPhase = rand * 10.0;

        // Gentle vertical movement (Bobbing)
        float yOffset = sin(time * bobSpeed + bobPhase) * 0.03;

        transformed.y += yOffset;

        // Gentle Tilting (Wobble) with waves
        float wobbleX = sin(time * bobSpeed * 0.7 + bobPhase) * 0.05;
        float wobbleZ = cos(time * bobSpeed * 0.6 + bobPhase) * 0.05;

        // Apply rotation roughly
        transformed.y += transformed.x * wobbleX;
        transformed.y += transformed.z * wobbleZ;
        `
      );
      mat.userData.shader = shader;
    };
    return mat;
  }, []);

  useFrame((state) => {
    if (material.userData.shader) {
      material.userData.shader.uniforms.time.value = state.clock.elapsedTime;
    }
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
