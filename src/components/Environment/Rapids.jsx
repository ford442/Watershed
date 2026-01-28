import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function Rapids({ transforms, flowSpeed = 1.0 }) {
  const meshRef = useRef();

  // Low poly "foam pile" geometry
  // Detail 0 Icosahedron is chunky and looks like stylized foam
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(0.3, 0), []);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.8, // Rough foam
      metalness: 0.1,
      emissive: '#e0f7fa',
      emissiveIntensity: 0.2,
      flatShading: true, // Enhances the low-poly look
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = { value: 0 };
      shader.uniforms.flowSpeed = { value: flowSpeed };

      // Pass uniforms to vertex shader
      shader.vertexShader = `
        uniform float time;
        uniform float flowSpeed;
        varying float vNoise;
      ` + shader.vertexShader;

      // Simple vertex wobble
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>

        // Simple procedural noise
        float noise = sin(position.x * 5.0 + time * flowSpeed * 3.0)
                    * sin(position.z * 4.0 + time * flowSpeed * 2.5)
                    * sin(position.y * 3.0 + time * flowSpeed * 4.0);

        // Displace along normal ("Boiling")
        float displacement = noise * 0.15 * flowSpeed;
        transformed += normal * displacement;

        // Pass noise to fragment for color variation
        vNoise = noise;
        `
      );

      // Fragment pulsing
      shader.fragmentShader = `
        uniform float time;
        varying float vNoise;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #include <map_fragment>

        // Pulse emission based on noise
        float pulse = smoothstep(0.2, 0.8, vNoise);
        diffuseColor.rgb += vec3(0.1, 0.2, 0.3) * pulse; // Add bluish tint to peaks
        `
      );

      mat.userData.shader = shader;
    };

    return mat;
  }, [flowSpeed]);

  useFrame((state) => {
    if (material.userData.shader) {
      material.userData.shader.uniforms.time.value = state.clock.elapsedTime;
    }
  });

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
