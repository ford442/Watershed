import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBiome } from '../../systems/BiomeSystem';
import type { CanyonDustProps } from './types';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import { createCanyonDustMaterial } from '../../materials/vfx/createVfxMaterials';
import { materialUniformBag } from '../../materials/dual/materialUniformBag';

const DUMMY_OBJ = new THREE.Object3D();

const DUST_DENSITY_BY_BIOME: Record<string, number> = {
  canyonAutumn: 1.8,
  slotCanyon: 1.4,
  cavern: 1.2,
};

export default function CanyonDust({
  transforms,
  flowSpeed = 1.0,
  playerVelocityRef,
  count = 64,
  maxDistance = 30,
}: CanyonDustProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const { currentBiome } = useBiome();
  const densityMul = DUST_DENSITY_BY_BIOME[currentBiome.id] ?? 1.0;

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

  const material = useMemo(
    () =>
      createCanyonDustMaterial(resolveMaterialBackend().backend, {
        flowSpeed,
        colorBase: new THREE.Color('#f7e9cf'),
      }),
    [flowSpeed],
  );

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.visible = camera.position.distanceTo(segmentCenter) <= maxDistance;

    const u = materialUniformBag(material);
    if (u) {
      u.time.value = state.clock.elapsedTime;
      u.flowSpeed.value = flowSpeed;
      u.playerVelocity.value = playerVelocityRef?.current ?? 0;
      u.densityMul.value = densityMul;
      if (u.colorBase?.value instanceof THREE.Color) {
        u.colorBase.value.set(currentBiome.id === 'canyonAutumn' ? '#e8c79a' : '#f7e9cf');
      }
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

        scaleData[i * 3] = t.scale?.x ?? 0.2;
        scaleData[i * 3 + 1] = t.scale?.y ?? 0.25;
        scaleData[i * 3 + 2] = t.scale?.z ?? 0.2;
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
    <instancedMesh ref={meshRef} args={[geometry, material, poolSize]} frustumCulled={false} />
  );
}
