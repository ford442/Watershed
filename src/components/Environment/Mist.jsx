import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function Mist({ transforms }) {
  const meshRef = useRef();

  // Geometry: Simple Plane
  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(1, 1);
  }, []);

  // Custom Shader Material for Mist
  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending, // Soft blending
      uniforms: {
        time: { value: 0 },
        colorBase: { value: new THREE.Color('#e0f7fa') }, // White-ish blue
      },
      vertexShader: `
        uniform float time;
        varying float vAlpha;
        varying vec2 vUv;

        // Hash for randomness
        float hash(float n) { return fract(sin(n) * 43758.5453123); }

        void main() {
          vUv = uv;

          // Instance info
          vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float rand = hash(instancePos.xz * 12.0);

          // Billboarding (View Aligned)
          // Extract Camera Basis vectors from View Matrix
          vec3 viewRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 viewUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

          // Animation (Drift)
          float driftSpeed = 0.2 + rand * 0.2;
          vec3 drift = vec3(0.0);
          drift.x = sin(time * driftSpeed + rand * 10.0) * 0.5;
          drift.y = sin(time * driftSpeed * 0.5 + rand * 20.0) * 0.2;
          drift.z = cos(time * driftSpeed + rand * 10.0) * 0.5;

          // Scale
          float scale = 3.0 + rand * 3.0; // Large patches

          // Final Vertex Position
          // Start at instance center + drift
          vec3 finalPos = instancePos + drift;

          // Expand geometry along view vectors (Billboarding)
          finalPos += viewRight * position.x * scale;
          finalPos += viewUp * position.y * scale;

          gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);

          // Alpha Animation (Pulse)
          float pulse = sin(time * 0.5 + rand * 10.0);
          vAlpha = 0.3 + 0.2 * pulse; // 0.1 to 0.5 opacity
        }
      `,
      fragmentShader: `
        uniform vec3 colorBase;
        varying float vAlpha;
        varying vec2 vUv;

        void main() {
          // Soft Radial Gradient
          vec2 center = vec2(0.5, 0.5);
          float dist = distance(vUv, center);
          float alpha = smoothstep(0.5, 0.0, dist); // Fade out to edge

          // Noise overlay (Simulated with simple math for perf)
          // float noise = sin(vUv.x * 10.0) * sin(vUv.y * 10.0);

          gl_FragColor = vec4(colorBase, alpha * vAlpha);
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
      // We only need position from transform for our billboard shader logic
      DUMMY_OBJ.position.copy(t.position);
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
