import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function CanyonDust({
  transforms,
  flowSpeed = 1.0,
  playerVelocityRef = null,
  count = 64,
  maxDistance = 30,
}) {
  const meshRef = useRef();
  const { camera } = useThree();

  const poolSize = Math.max(1, count);
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(new Float32Array([0.2, 0.3, 0.2]), 3));
    return geo;
  }, []);
  const segmentCenter = useMemo(() => {
    if (!transforms || transforms.length === 0) return new THREE.Vector3();
    const center = new THREE.Vector3();
    transforms.forEach((t) => center.add(t.position));
    return center.multiplyScalar(1 / transforms.length);
  }, [transforms]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      time: { value: 0 },
      flowSpeed: { value: flowSpeed },
      playerVelocity: { value: 0 },
      colorBase: { value: new THREE.Color('#f7e9cf') },
    },
    vertexShader: `
      uniform float time;
      uniform float flowSpeed;
      uniform float playerVelocity;
      attribute vec3 instanceScale;
      varying float vAlpha;
      varying vec2 vUv;

      float hash(float n) { return fract(sin(n) * 43758.5453123); }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }

      void main() {
        vUv = uv;
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float rand = hash(instancePos.xz * 11.0);

        vec3 viewRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 viewUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

        vec3 drift = vec3(0.0);
        drift.x = sin(time * (0.6 + rand * 0.5) + rand * 8.0) * 0.25;
        drift.y = abs(sin(time * 0.35 + rand * 20.0)) * (0.18 + flowSpeed * 0.1);
        drift.z = cos(time * (0.7 + rand * 0.4) + rand * 12.0) * 0.25;
        drift.z += -playerVelocity * 0.12;

        float streakScale = 1.0 + clamp(playerVelocity, 0.0, 45.0) * 0.03;
        vec3 finalPos = instancePos + drift;
        finalPos += viewRight * position.x * instanceScale.x;
        finalPos += viewUp * position.y * instanceScale.y * streakScale;

        gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);

        float pulse = sin(time * 1.4 + rand * 20.0) * 0.5 + 0.5;
        vAlpha = mix(0.05, 0.12, pulse);
      }
    `,
    fragmentShader: `
      uniform vec3 colorBase;
      varying float vAlpha;
      varying vec2 vUv;

      void main() {
        vec2 center = vec2(0.5);
        float dist = distance(vUv, center);
        float alpha = smoothstep(0.5, 0.0, dist);
        gl_FragColor = vec4(colorBase, alpha * vAlpha);
      }
    `,
  }), [flowSpeed]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.visible = camera.position.distanceTo(segmentCenter) <= maxDistance;

    if (material.uniforms) {
      material.uniforms.time.value = state.clock.elapsedTime;
      material.uniforms.flowSpeed.value = flowSpeed;
      material.uniforms.playerVelocity.value = playerVelocityRef?.current ?? 0;
    }
  });

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const scaleData = new Float32Array(poolSize * 3);

    for (let i = 0; i < poolSize; i++) {
      const t = transforms?.[i];
      if (t) {
        DUMMY_OBJ.position.copy(t.position);
        DUMMY_OBJ.updateMatrix();
        mesh.setMatrixAt(i, DUMMY_OBJ.matrix);

        scaleData[i * 3] = t?.scale?.x ?? 0.2;
        scaleData[i * 3 + 1] = t?.scale?.y ?? 0.25;
        scaleData[i * 3 + 2] = t?.scale?.z ?? 0.2;
      } else {
        DUMMY_OBJ.position.set(0, -1000, 0);
        DUMMY_OBJ.updateMatrix();
        mesh.setMatrixAt(i, DUMMY_OBJ.matrix);
        scaleData[i * 3] = 0;
        scaleData[i * 3 + 1] = 0;
        scaleData[i * 3 + 2] = 0;
      }
    }

    mesh.geometry.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(scaleData, 3));
    mesh.instanceMatrix.needsUpdate = true;
  }, [poolSize, transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, poolSize]}
      frustumCulled={false}
    />
  );
}
