import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const MAX_DROPLETS = 180;

const plumeNoise = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

export default function WaterfallImpactZone({
  width = 10,
  flowSpeed = 1.2,
  intensity = 1,
  particleDensity = 1,
  playerVelocity = 0,
}) {
  const plumeRef = useRef(null);
  const foamRef = useRef(null);
  const dropletRef = useRef(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const plumeGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const plumeMaterial = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      time: { value: 0 },
      intensity: { value: intensity },
      colorBase: { value: new THREE.Color('#d8eff8') },
    },
    vertexShader: `
      uniform float time;
      uniform float intensity;
      varying vec2 vUv;
      varying float vAlpha;
      ${plumeNoise}

      void main() {
        vUv = uv;
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vec3 viewRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 viewUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float rand = hash(instancePos.xz * 1.7 + vec2(instancePos.y));
        float sway = sin(time * 0.7 + rand * 8.0 + position.y * 2.2) * 0.25;
        float lift = abs(sin(time * 0.5 + rand * 6.0)) * 0.35;
        float widthScale = 2.2 + rand * 1.6;
        float heightScale = 2.8 + rand * 3.5;
        vec3 finalPos = instancePos;
        finalPos += viewRight * (position.x + sway) * widthScale;
        finalPos += viewUp * (position.y + lift) * heightScale;
        gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);
        vAlpha = (1.0 - uv.y) * (0.28 + rand * 0.2) * intensity;
      }
    `,
    fragmentShader: `
      uniform vec3 colorBase;
      varying vec2 vUv;
      varying float vAlpha;
      ${plumeNoise}

      void main() {
        vec2 centered = vUv - 0.5;
        float radial = smoothstep(0.55, 0.0, length(centered * vec2(1.0, 1.5)));
        float wisps = noise(vUv * 5.0 + vec2(0.0, vUv.y * 2.0));
        float alpha = radial * smoothstep(0.2, 0.85, wisps) * vAlpha;
        gl_FragColor = vec4(colorBase, alpha);
      }
    `,
  }), [intensity]);

  const foamGeometry = useMemo(() => new THREE.CircleGeometry(Math.max(2.5, width * 0.42), 40), [width]);
  const foamMaterial = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      time: { value: 0 },
      flowSpeed: { value: flowSpeed },
      churnBoost: { value: intensity },
      colorBase: { value: new THREE.Color('#eefcff') },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float flowSpeed;
      uniform float churnBoost;
      uniform vec3 colorBase;
      varying vec2 vUv;
      ${plumeNoise}

      void main() {
        vec2 centered = vUv - 0.5;
        float dist = length(centered);
        float ring = smoothstep(0.48, 0.12, dist);
        float core = smoothstep(0.22, 0.0, dist);
        float swirl = noise(centered * 7.0 + vec2(time * flowSpeed * 0.35, -time * flowSpeed * 0.25));
        float churn = noise(centered * 12.0 + vec2(-time * flowSpeed * 0.6, time * flowSpeed * 0.45));
        float foam = smoothstep(0.38, 0.95, swirl * 0.55 + churn * 0.45);
        float alpha = (ring * 0.45 + core * 0.35) * foam * (0.7 + churnBoost * 0.2);
        gl_FragColor = vec4(colorBase, alpha);
      }
    `,
  }), [flowSpeed, intensity]);

  const dropletGeometry = useMemo(() => new THREE.BoxGeometry(0.18, 0.28, 0.18), []);
  const dropletMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#e9fbff',
    transparent: true,
    opacity: 0.72,
    roughness: 0.15,
    emissive: '#c9efff',
    emissiveIntensity: 0.35,
  }), []);

  const plumeInstances = useMemo(() => {
    const count = 10;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const radius = 0.8 + (i % 3) * 0.55;
      return new THREE.Vector3(Math.cos(angle) * radius, 1.0 + (i % 4) * 0.45, Math.sin(angle) * radius * 0.55);
    });
  }, []);

  useEffect(() => {
    if (!plumeRef.current) return;
    plumeInstances.forEach((instance, index) => {
      dummy.position.copy(instance);
      dummy.updateMatrix();
      plumeRef.current.setMatrixAt(index, dummy.matrix);
    });
    plumeRef.current.instanceMatrix.needsUpdate = true;
  }, [plumeInstances, dummy]);

  const droplets = useMemo(() => {
    const velocityScale = Math.min(1.8, 0.8 + playerVelocity * 0.015 + particleDensity * 0.25);
    return Array.from({ length: MAX_DROPLETS }, (_, i) => {
      const angle = (i / MAX_DROPLETS) * Math.PI * 2;
      const burst = 1.4 + ((i * 17) % 23) / 10;
      return {
        angle,
        position: new THREE.Vector3(
          Math.cos(angle) * 0.6,
          ((i * 13) % 21) / 21,
          Math.sin(angle) * 0.6
        ),
        velocity: new THREE.Vector3(
          Math.cos(angle) * burst * velocityScale,
          (2.6 + ((i * 7) % 11) * 0.22) * velocityScale,
          Math.sin(angle) * burst * 0.7 * velocityScale
        ),
        life: ((i * 19) % 100) / 100,
        scale: 0.6 + ((i * 29) % 9) * 0.08,
      };
    });
  }, [playerVelocity, particleDensity]);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    if (plumeRef.current) plumeRef.current.material.uniforms.time.value = time;
    if (foamRef.current) foamRef.current.material.uniforms.time.value = time;

    if (!dropletRef.current) return;

    const spawnScale = THREE.MathUtils.clamp(intensity * (0.75 + particleDensity * 0.35), 0.4, 1.7);
    droplets.forEach((droplet, index) => {
      droplet.life += delta * (0.9 + spawnScale * 0.6);
      if (droplet.life >= 1) droplet.life -= 1;
      const age = droplet.life;
      const px = droplet.position.x + droplet.velocity.x * age * 0.32;
      const py = droplet.position.y + droplet.velocity.y * age * 0.3 - 2.8 * age * age;
      const pz = droplet.position.z + droplet.velocity.z * age * 0.26;
      const scale = Math.max(0, (1 - age) * droplet.scale * 0.22 * spawnScale);
      dummy.position.set(px, py, pz);
      dummy.scale.setScalar(scale);
      dummy.rotation.set(age * 4.0, droplet.angle + age * 3.0, age * 2.0);
      dummy.updateMatrix();
      dropletRef.current.setMatrixAt(index, dummy.matrix);
    });
    dropletRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={plumeRef} args={[plumeGeometry, plumeMaterial, plumeInstances.length]} frustumCulled={false}>
      </instancedMesh>
      <mesh
        ref={foamRef}
        geometry={foamGeometry}
        material={foamMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.08, 0]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={dropletRef}
        args={[dropletGeometry, dropletMaterial, MAX_DROPLETS]}
        frustumCulled={false}
      />
    </group>
  );
}
