import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function Mist({
  transforms,
  flowSpeed = 1.0,
  playerVelocityRef = null,
  isSlotCanyon = false,
}) {
  const meshRef = useRef();

  // Geometry: Simple Plane
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3));
    geo.setAttribute('mistType', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
    return geo;
  }, []);

  // Custom Shader Material for Mist
  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending, // Soft blending
      uniforms: {
        time: { value: 0 },
        colorBase: { value: new THREE.Color('#d8eaf0') }, // Cool blue-grey matching scene fog
        flowSpeed: { value: flowSpeed },
        playerVelocity: { value: 0 },
        isSlotCanyon: { value: isSlotCanyon ? 1.0 : 0.0 },
      },
      vertexShader: `
        uniform float time;
        uniform float flowSpeed;
        uniform float playerVelocity;
        uniform float isSlotCanyon;
        varying float vAlpha;
        varying vec2 vUv;
        varying float vType;

        // Hash for randomness
        float hash(float n) { return fract(sin(n) * 43758.5453123); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }
        attribute vec3 instanceScale;
        attribute float mistType;

        void main() {
          vUv = uv;
          vType = mistType;

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
          float flowInfluence = 1.0 + flowSpeed * 0.5;
          drift.x = sin(time * driftSpeed + rand * 10.0) * 0.3 * flowInfluence;
          drift.y = abs(sin(time * driftSpeed * 0.3 + rand * 20.0)) * 0.4 * (1.0 + flowSpeed * 0.3);
          drift.z = cos(time * driftSpeed + rand * 10.0) * 0.35 * flowInfluence;
          if (isSlotCanyon > 0.5) {
            drift.y += 0.12 + mistType * 0.25;
          }

          // Scale from authored transforms
          float baseScale = max(0.2, instanceScale.x) * (2.0 + rand * 1.2);
          float verticalScale = max(0.2, instanceScale.y) * (1.8 + rand * 1.0);
          float velocityStretch = 1.0 + clamp(playerVelocity, 0.0, 45.0) * 0.04;

          // Final Vertex Position
          // Start at instance center + drift
          vec3 finalPos = instancePos + drift;

          // Expand geometry along view vectors (Billboarding)
          finalPos += viewRight * position.x * baseScale;
          finalPos += viewUp * position.y * verticalScale * velocityStretch;

          gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);

          // Alpha Animation (Pulse)
          float pulse = sin(time * 0.5 + rand * 10.0);
          float floorAlpha = 0.28 + 0.18 * pulse;
          float columnAlpha = 0.35 + 0.22 * pulse;
          vAlpha = mix(floorAlpha, columnAlpha, clamp(mistType, 0.0, 1.0));
        }
      `,
      fragmentShader: `
        uniform vec3 colorBase;
        varying float vAlpha;
        varying vec2 vUv;
        varying float vType;

        void main() {
          // Soft Radial Gradient
          vec2 center = vec2(0.5, 0.5);
          float dist = distance(vUv, center);
          float alpha = smoothstep(0.5, 0.0, dist); // Fade out to edge
          float columnBoost = mix(1.0, 1.2, clamp(vType, 0.0, 1.0));

          gl_FragColor = vec4(colorBase, alpha * vAlpha * columnBoost);
        }
      `
    });

    return mat;
  }, [flowSpeed, isSlotCanyon]);

  useFrame((state) => {
    if (material.uniforms) {
      material.uniforms.time.value = state.clock.elapsedTime;
      material.uniforms.flowSpeed.value = flowSpeed;
      material.uniforms.isSlotCanyon.value = isSlotCanyon ? 1.0 : 0.0;
      material.uniforms.playerVelocity.value = playerVelocityRef?.current ?? 0;
    }
  });

  // Setup Instances
  useEffect(() => {
    if (!meshRef.current || !transforms || transforms.length === 0) return;

    const mesh = meshRef.current;

    const scaleData = new Float32Array(transforms.length * 3);
    const typeData = new Float32Array(transforms.length);

    transforms.forEach((t, i) => {
      // We only need position from transform for our billboard shader logic
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);

      const sx = t?.scale?.x ?? 1;
      const sy = t?.scale?.y ?? 1;
      const sz = t?.scale?.z ?? 1;
      scaleData[i * 3] = sx;
      scaleData[i * 3 + 1] = sy;
      scaleData[i * 3 + 2] = sz;
      typeData[i] = t?.type === 'column' ? 1 : 0;
    });

    mesh.geometry.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(scaleData, 3));
    mesh.geometry.setAttribute('mistType', new THREE.InstancedBufferAttribute(typeData, 1));
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
