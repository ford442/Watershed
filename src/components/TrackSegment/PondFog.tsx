import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBiome } from '../../systems/BiomeSystem';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import { createPondFogMaterial } from '../../materials/vfx/createVfxMaterials';
import { materialUniformBag } from '../../materials/dual/materialUniformBag';

export interface PondFogProps {
  segmentCenter: THREE.Vector3;
  waterLevel?: number;
}

/**
 * PondFog - Temporary dense fog when camera is inside a pond segment, plus a
 * swirling ground-hugging mist bank that sits on the water surface and
 * catches sun/moon color and reacts to weather.
 */
export default function PondFog({ segmentCenter, waterLevel = 0.5 }: PondFogProps) {
  const { camera, scene } = useThree();
  const { timeOfDay } = useBiome();
  const originalFogRef = useRef<{
    color: THREE.Color;
    near: number;
    far: number;
  } | null>(null);
  const isActiveRef = useRef(false);
  const groundMistRef = useRef<THREE.Mesh>(null);
  const [weatherType, setWeatherType] = useState('clear');

  useEffect(() => {
    const onWeatherUpdate = (event: Event) => {
      const incoming = (event as CustomEvent<{ type?: string }>).detail?.type;
      if (typeof incoming === 'string') setWeatherType(incoming);
    };
    window.addEventListener('weather-update', onWeatherUpdate);
    return () => window.removeEventListener('weather-update', onWeatherUpdate);
  }, []);

  useEffect(() => {
    const fog = scene.fog as THREE.Fog | null;
    originalFogRef.current = fog
      ? {
          color: fog.color.clone(),
          near: fog.near,
          far: fog.far,
        }
      : null;
    return () => {
      const currentFog = scene.fog as THREE.Fog | null;
      if (originalFogRef.current && currentFog) {
        currentFog.color.set(originalFogRef.current.color);
        currentFog.near = originalFogRef.current.near;
        currentFog.far = originalFogRef.current.far;
      }
    };
  }, [scene]);

  const groundMistMaterial = useMemo(
    () => createPondFogMaterial(resolveMaterialBackend().backend, { tintColor: new THREE.Color('#c8d8d0') }),
    [],
  );

  useFrame((state) => {
    const fog = scene.fog as THREE.Fog | null;
    if (!fog) return;
    const dist = camera.position.distanceTo(segmentCenter);
    const shouldBeActive = dist < 40;
    const stormBlend = weatherType === 'storm' ? 1 : weatherType === 'overcast' ? 0.4 : 0;

    const dayPhase = Math.abs(timeOfDay - 0.5) * 2;
    const nightFactor = THREE.MathUtils.smoothstep(dayPhase, 0.6, 0.85);
    const sunsetBlend = THREE.MathUtils.smoothstep(timeOfDay, 0.65, 0.9);
    const baseFogColor = new THREE.Color('#c8d8d0');
    if (nightFactor > sunsetBlend) {
      baseFogColor.lerp(new THREE.Color('#7e8fb0'), nightFactor * 0.5);
    } else {
      baseFogColor.lerp(new THREE.Color('#f0c79a'), sunsetBlend * 0.45);
    }
    baseFogColor.lerp(new THREE.Color('#5a6066'), stormBlend * 0.6);

    if (shouldBeActive && !isActiveRef.current) {
      isActiveRef.current = true;
    } else if (!shouldBeActive && isActiveRef.current) {
      isActiveRef.current = false;
      if (originalFogRef.current) {
        fog.color.set(originalFogRef.current.color);
        fog.near = originalFogRef.current.near;
        fog.far = originalFogRef.current.far;
      }
    }

    if (isActiveRef.current) {
      fog.color.copy(baseFogColor);
      fog.near = stormBlend > 0.5 ? 8 : 15;
      fog.far = stormBlend > 0.5 ? 32 : 50;
    }

    if (groundMistRef.current) {
      groundMistRef.current.position.set(segmentCenter.x, waterLevel + 0.08, segmentCenter.z);
      const targetOpacity = isActiveRef.current ? 0.35 + stormBlend * 0.25 : 0;
      const u = materialUniformBag(groundMistMaterial);
      if (u?.opacity) {
        u.opacity.value = THREE.MathUtils.lerp(u.opacity.value as number, targetOpacity, 0.04);
      }
      if (u?.time) u.time.value = state.clock.elapsedTime;
      if (u?.tintColor?.value instanceof THREE.Color) u.tintColor.value.copy(baseFogColor);
    }
  });

  return (
    <mesh ref={groundMistRef} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} renderOrder={1}>
      <planeGeometry args={[90, 90, 1, 1]} />
      <primitive object={groundMistMaterial} attach="material" />
    </mesh>
  );
}
