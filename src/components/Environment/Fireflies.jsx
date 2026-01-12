import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function Fireflies({ transforms }) {
  const meshRef = useRef();

  // Geometry: Very simple low-poly shape (Tetrahedron is only 4 triangles)
  const geometry = useMemo(() => {
    return new THREE.TetrahedronGeometry(0.1, 0);
  }, []);

  // Custom Shader Material for blinking and movement
  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false, // Don't write to depth buffer so they don't occlude each other weirdly if overlapping and for better glow feel
      blending: THREE.AdditiveBlending, // Glow effect
      uniforms: {
        time: { value: 0 },
        colorBase: { value: new THREE.Color('#ffdd55') }, // Warm yellow
      },
      vertexShader: `
        uniform float time;
        varying float vAlpha;
        varying vec3 vColorMult;

        // Hash for randomness
        float hash(float n) { return fract(sin(n) * 43758.5453123); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        void main() {
          // Instance-based randomness
          vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float rand = hash(instancePos.xz);
          float rand2 = hash(instancePos.zx);

          // Floating Animation (Vertex Displacement)
          float floatSpeed = 0.5 + rand * 0.5;
          float floatAmp = 0.5 + rand * 0.5;

          vec3 offset = vec3(0.0);
          offset.x = sin(time * floatSpeed + rand * 10.0) * floatAmp;
          offset.y = sin(time * floatSpeed * 1.3 + rand2 * 10.0) * floatAmp * 0.5; // Less vertical movement
          offset.z = cos(time * floatSpeed * 0.8 + rand * 20.0) * floatAmp;

          // Apply offset to the instance position (effectively)
          // We do this by modifying gl_Position or the modelViewMatrix
          // Standard approach for instanced meshes with custom shaders:
          // Transform local vertex by instance matrix, then apply world offset, then view/proj.

          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);

          // Apply world space offset (in view space approximate or before view)
          // Actually, adding to mvPosition.xyz applies it in View Space.
          // Since the offset is small and random, View Space is fine and easier than decomposing matrix.
          mvPosition.xyz += offset;

          gl_Position = projectionMatrix * mvPosition;

          // Blinking Animation (Alpha)
          float blinkSpeed = 2.0 + rand * 3.0;
          float blinkPhase = rand * 10.0;

          // Smooth blink: sine wave mapped to 0.0 -> 1.0
          float blink = sin(time * blinkSpeed + blinkPhase);
          blink = smoothstep(-0.2, 0.8, blink); // Sharpen the peak slightly

          vAlpha = 0.3 + 0.7 * blink; // Never fully invisible

          // Color variation
          vColorMult = vec3(1.0);
          if (rand > 0.7) vColorMult = vec3(0.8, 1.0, 0.5); // Greenish tint
          else if (rand < 0.3) vColorMult = vec3(1.0, 0.6, 0.2); // Orange tint
        }
      `,
      fragmentShader: `
        uniform vec3 colorBase;
        varying float vAlpha;
        varying vec3 vColorMult;

        void main() {
          // Circular glow shape (soft particle)
          // Since we are using a Tetrahedron, UVs are messy.
          // Let's just use a solid color with the calculated alpha.
          // The additive blending will make it look like a light source.

          vec3 finalColor = colorBase * vColorMult;

          // Distance fade could be added here if we had depth info, but for now simple alpha
          gl_FragColor = vec4(finalColor, vAlpha);
        }
      `
    });

    return mat;
  }, []);

  useFrame((state) => {
    if (material.uniforms) {
      material.uniforms.time.value = state.clock.elapsedTime;
    }
  });

  // Setup Instances
  useEffect(() => {
    if (!meshRef.current || !transforms || transforms.length === 0) return;

    const mesh = meshRef.current;

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.set(0, 0, 0); // No rotation needed really
      DUMMY_OBJ.scale.setScalar(1.0); // Uniform scale
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
      frustumCulled={false} // Prevent culling when floating slightly out of bound
    />
  );
}
