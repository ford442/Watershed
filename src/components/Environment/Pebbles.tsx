import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { createRockSurfaceMaterial } from '../../materials/foliage/createFoliageSurfaceMaterial';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import type { PebblesProps } from './types';

type PebbleShape = 'round' | 'flat' | 'angular';

interface PebbleInstance {
  key: string;
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  scale: THREE.Vector3;
}

const PEBBLE_GEOMETRIES: Record<PebbleShape, () => THREE.BufferGeometry> = {
  round: () => new THREE.IcosahedronGeometry(0.2, 1),
  flat: () => {
    const geo = new THREE.IcosahedronGeometry(0.22, 1);
    geo.scale(1.3, 0.55, 1.1);
    geo.computeVertexNormals();
    return geo;
  },
  angular: () => new THREE.OctahedronGeometry(0.2, 0),
};

const SHAPE_KEYS: PebbleShape[] = ['round', 'flat', 'angular'];
const DEFAULT_ROTATION = new THREE.Euler();
const DEFAULT_SCALE = new THREE.Vector3(1, 1, 1);

export default function Pebbles({ transforms, material }: PebblesProps) {
  const geometries = useMemo(() => {
    const lib = {} as Record<PebbleShape, THREE.BufferGeometry>;
    (Object.entries(PEBBLE_GEOMETRIES) as [PebbleShape, () => THREE.BufferGeometry][]).forEach(([key, make]) => {
      lib[key] = make();
    });
    return lib;
  }, []);

  const defaultMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#666660', roughness: 0.85, metalness: 0.0 }),
    [],
  );

  const pebbleMaterial = useMemo(() => {
    const base = (material ?? defaultMaterial).clone() as THREE.MeshStandardMaterial;
    return createRockSurfaceMaterial(resolveMaterialBackend().backend, base, {
      mossStrength: 0.45,
      streakStrength: 0.25,
      bandStrength: 0.0,
      dustStrength: 0.3,
      rimStrength: 0.1,
      wetnessRange: 1.2,
    }) as THREE.MeshStandardMaterial;
  }, [material, defaultMaterial]);

  const grouped = useMemo(() => {
    const byShape: Record<PebbleShape, PebbleInstance[]> = { round: [], flat: [], angular: [] };
    if (!transforms) return byShape;

    transforms.forEach((t, i) => {
      const shape = SHAPE_KEYS[i % SHAPE_KEYS.length];
      const isHero = i % 17 === 0;
      const heroScale = isHero ? 2.4 : 1;
      const baseScale = t.scale ?? DEFAULT_SCALE;
      const scale = baseScale.clone().multiplyScalar(heroScale);

      byShape[shape].push({
        key: `pebble-${i}`,
        position: t.position,
        rotation: t.rotation ?? DEFAULT_ROTATION,
        scale,
      });
    });

    return byShape;
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <group>
      {SHAPE_KEYS.map((shape) => {
        const instances = grouped[shape];
        if (!instances.length) return null;
        return (
          <Instances
            key={shape}
            range={instances.length}
            geometry={geometries[shape]}
            material={pebbleMaterial}
            castShadow
            receiveShadow
          >
            {instances.map((data) => (
              <Instance
                key={data.key}
                position={data.position}
                rotation={data.rotation}
                scale={data.scale}
              />
            ))}
          </Instances>
        );
      })}
    </group>
  );
}
