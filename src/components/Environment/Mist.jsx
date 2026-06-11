import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBiome } from '../../systems/BiomeSystem';

const DUMMY_OBJ = new THREE.Object3D();

export default function Mist({
  transforms,
  flowSpeed = 1.0,
  playerVelocityRef = null,
  isSlotCanyon = false,
}) {
  const meshRef = useRef();
  const { camera } = useThree();
  const { timeOfDay } = useBiome();
  const [weatherType, setWeatherType] = useState('clear');

  useEffect(() => {
    const onWeatherUpdate = (event) => {
      const incoming = event?.detail?.type;
      if (typeof incoming === 'string') setWeatherType(incoming);
    };
    window.addEventListener('weather-update', onWeatherUpdate);
    return () => window.removeEventListener('weather-update', onWeatherUpdate);
  }, []);

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
        playerPos: { value: new THREE.Vector3(0, -1000, 0) },
        tintColor: { value: new THREE.Color('#d8eaf0') },
        tintStrength: { value: 0 },
        stormBlend: { value: 0 },
      },
      vertexShader: `
        uniform float time;
        uniform float flowSpeed;
        uniform float playerVelocity;
        uniform float isSlotCanyon;
        uniform vec3 playerPos;
        uniform float stormBlend;
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

          // Player/raft wake: nearby mist parts and swirls outward as the
          // player passes through it at speed.
          vec2 toMote = instancePos.xz - playerPos.xz;
          float distToPlayer = length(toMote);
          float pushRadius = 4.5 + clamp(playerVelocity, 0.0, 45.0) * 0.04;
          if (distToPlayer < pushRadius && distToPlayer > 0.001) {
            float pushAmt = (1.0 - distToPlayer / pushRadius);
            pushAmt = pushAmt * pushAmt * (1.5 + clamp(playerVelocity, 0.0, 45.0) * 0.05);
            drift.xz += normalize(toMote) * pushAmt;
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
          // Storms thicken the mist into the ground.
          vAlpha *= mix(1.0, 1.35, stormBlend);
        }
      `,
      fragmentShader: `
        uniform vec3 colorBase;
        uniform vec3 tintColor;
        uniform float tintStrength;
        uniform float stormBlend;
        varying float vAlpha;
        varying vec2 vUv;
        varying float vType;

        void main() {
          // Soft Radial Gradient
          vec2 center = vec2(0.5, 0.5);
          float dist = distance(vUv, center);
          float alpha = smoothstep(0.5, 0.0, dist); // Fade out to edge
          float columnBoost = mix(1.0, 1.2, clamp(vType, 0.0, 1.0));

          // Catch ambient sun/moon color, darken under storm cover.
          vec3 finalColor = mix(colorBase, tintColor, tintStrength);
          finalColor = mix(finalColor, finalColor * 0.55, stormBlend);

          gl_FragColor = vec4(finalColor, alpha * vAlpha * columnBoost);
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
      material.uniforms.playerPos.value.copy(camera.position);

      // Tint toward warm sunlight at golden hour, cool moonlight at night.
      const dayPhase = Math.abs(timeOfDay - 0.5) * 2;
      const nightFactor = THREE.MathUtils.smoothstep(dayPhase, 0.6, 0.85);
      const sunsetBlend = THREE.MathUtils.smoothstep(timeOfDay, 0.65, 0.9);
      if (nightFactor > sunsetBlend) {
        material.uniforms.tintColor.value.set('#9fb6e8');
        material.uniforms.tintStrength.value = nightFactor * 0.45;
      } else {
        material.uniforms.tintColor.value.set('#ffcf9e');
        material.uniforms.tintStrength.value = sunsetBlend * 0.5;
      }

      const stormBlend = weatherType === 'storm' ? 1 : weatherType === 'overcast' ? 0.4 : 0;
      material.uniforms.stormBlend.value = stormBlend;
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
