import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBiome } from '../../systems/BiomeSystem';
import type { MistPlacement, MistProps, WeatherUpdateEvent } from './types';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import { createMistMaterial } from '../../materials/vfx/createVfxMaterials';
import { materialUniformBag } from '../../materials/dual/materialUniformBag';

const DUMMY_OBJ = new THREE.Object3D();

export default function Mist({
  transforms,
  flowSpeed = 1.0,
  playerVelocityRef,
  isSlotCanyon = false,
}: MistProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const { timeOfDay } = useBiome();
  const [weatherType, setWeatherType] = useState('clear');

  useEffect(() => {
    const onWeatherUpdate = (event: WeatherUpdateEvent) => {
      const incoming = event?.detail?.type;
      if (typeof incoming === 'string') setWeatherType(incoming);
    };
    window.addEventListener('weather-update', onWeatherUpdate as EventListener);
    return () => window.removeEventListener('weather-update', onWeatherUpdate as EventListener);
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3));
    geo.setAttribute('mistType', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
    return geo;
  }, []);

  const material = useMemo(
    () =>
      createMistMaterial(resolveMaterialBackend().backend, {
        colorBase: new THREE.Color('#d8eaf0'),
        flowSpeed,
        isSlotCanyon,
      }),
    [flowSpeed, isSlotCanyon],
  );

  useFrame((state) => {
    const u = materialUniformBag(material);
    if (u) {
      u.time.value = state.clock.elapsedTime;
      u.flowSpeed.value = flowSpeed;
      u.isSlotCanyon.value = isSlotCanyon ? 1.0 : 0.0;
      u.playerVelocity.value = playerVelocityRef?.current ?? 0;
      if (u.playerPos?.value instanceof THREE.Vector3) {
        u.playerPos.value.copy(camera.position);
      }

      const dayPhase = Math.abs(timeOfDay - 0.5) * 2;
      const nightFactor = THREE.MathUtils.smoothstep(dayPhase, 0.6, 0.85);
      const sunsetBlend = THREE.MathUtils.smoothstep(timeOfDay, 0.65, 0.9);
      if (u.tintColor?.value instanceof THREE.Color) {
        if (nightFactor > sunsetBlend) {
          u.tintColor.value.set('#9fb6e8');
          u.tintStrength.value = nightFactor * 0.45;
        } else {
          u.tintColor.value.set('#ffcf9e');
          u.tintStrength.value = sunsetBlend * 0.5;
        }
      }

      const stormBlend = weatherType === 'storm' ? 1 : weatherType === 'overcast' ? 0.4 : 0;
      u.stormBlend.value = stormBlend;
    }
  });

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !transforms || transforms.length === 0) return;

    const scaleData = new Float32Array(transforms.length * 3);
    const typeData = new Float32Array(transforms.length);

    transforms.forEach((t: MistPlacement, i: number) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);

      const sx = t.scale?.x ?? 1;
      const sy = t.scale?.y ?? 1;
      const sz = t.scale?.z ?? 1;
      scaleData[i * 3] = sx;
      scaleData[i * 3 + 1] = sy;
      scaleData[i * 3 + 2] = sz;
      typeData[i] = t.type === 'column' ? 1 : 0;
    });

    mesh.geometry.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(scaleData, 3));
    mesh.geometry.setAttribute('mistType', new THREE.InstancedBufferAttribute(typeData, 1));
    mesh.instanceMatrix.needsUpdate = true;
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, transforms.length]} frustumCulled={false} />
  );
}
