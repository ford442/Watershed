import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { WaterfallImpactZoneProps } from './types';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import {
  createWaterfallFoamMaterial,
  createWaterfallPlumeMaterial,
} from '../../materials/vfx/createVfxMaterials';
import { materialUniformBag } from '../../materials/dual/materialUniformBag';

const MAX_DROPLETS = 180;

interface ImpactDroplet {
  angle: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  scale: number;
}

export default function WaterfallImpactZone({
  width = 10,
  flowSpeed = 1.2,
  intensity = 1,
  particleDensity = 1,
  playerVelocity = 0,
}: WaterfallImpactZoneProps) {
  const plumeRef = useRef<THREE.InstancedMesh>(null);
  const foamRef = useRef<THREE.Mesh>(null);
  const dropletRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const plumeGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const plumeMaterial = useMemo(
    () =>
      createWaterfallPlumeMaterial(resolveMaterialBackend().backend, {
        intensity,
        colorBase: new THREE.Color('#d8eff8'),
      }),
    [intensity],
  );

  const foamGeometry = useMemo(() => new THREE.CircleGeometry(Math.max(2.5, width * 0.42), 40), [width]);
  const foamMaterial = useMemo(
    () =>
      createWaterfallFoamMaterial(resolveMaterialBackend().backend, {
        flowSpeed,
        churnBoost: intensity,
        colorBase: new THREE.Color('#eefcff'),
      }),
    [flowSpeed, intensity],
  );

  const dropletGeometry = useMemo(() => new THREE.BoxGeometry(0.18, 0.28, 0.18), []);
  const dropletMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#e9fbff',
        transparent: true,
        opacity: 0.72,
        roughness: 0.15,
        emissive: '#c9efff',
        emissiveIntensity: 0.35,
      }),
    [],
  );

  const plumeInstances = useMemo(() => {
    const count = 10;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const radius = 0.8 + (i % 3) * 0.55;
      return new THREE.Vector3(Math.cos(angle) * radius, 1.0 + (i % 4) * 0.45, Math.sin(angle) * radius * 0.55);
    });
  }, []);

  useEffect(() => {
    const plumeMesh = plumeRef.current;
    if (!plumeMesh) return;
    plumeInstances.forEach((instance, index) => {
      dummy.position.copy(instance);
      dummy.updateMatrix();
      plumeMesh.setMatrixAt(index, dummy.matrix);
    });
    plumeMesh.instanceMatrix.needsUpdate = true;
  }, [plumeInstances, dummy]);

  const droplets = useMemo((): ImpactDroplet[] => {
    const velocityScale = Math.min(1.8, 0.8 + playerVelocity * 0.015 + particleDensity * 0.25);
    return Array.from({ length: MAX_DROPLETS }, (_, i) => {
      const angle = (i / MAX_DROPLETS) * Math.PI * 2;
      const burst = 1.4 + ((i * 17) % 23) / 10;
      return {
        angle,
        position: new THREE.Vector3(
          Math.cos(angle) * 0.6,
          ((i * 13) % 21) / 21,
          Math.sin(angle) * 0.6,
        ),
        velocity: new THREE.Vector3(
          Math.cos(angle) * burst * velocityScale,
          (2.6 + ((i * 7) % 11) * 0.22) * velocityScale,
          Math.sin(angle) * burst * 0.7 * velocityScale,
        ),
        life: ((i * 19) % 100) / 100,
        scale: 0.6 + ((i * 29) % 9) * 0.08,
      };
    });
  }, [playerVelocity, particleDensity]);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    const plumeMesh = plumeRef.current;
    const foamMesh = foamRef.current;
    const dropletMesh = dropletRef.current;

    const plumeU = materialUniformBag(plumeMesh?.material as THREE.Material | undefined);
    if (plumeU?.time) plumeU.time.value = time;
    const foamU = materialUniformBag(foamMesh?.material as THREE.Material | undefined);
    if (foamU?.time) foamU.time.value = time;

    if (!dropletMesh) return;

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
      dropletMesh.setMatrixAt(index, dummy.matrix);
    });
    dropletMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={plumeRef} args={[plumeGeometry, plumeMaterial, plumeInstances.length]} frustumCulled={false} />
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
