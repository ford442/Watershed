import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { extendRockMaterial } from '../../utils/RockShader';

// A handful of low-poly shapes so a streambed reads as a mix of worn pebbles,
// flatter river stones and the occasional angular fragment - not identical
// blobs.
const PEBBLE_GEOMETRIES = {
  round: () => new THREE.IcosahedronGeometry(0.2, 1),
  flat: () => {
    const geo = new THREE.IcosahedronGeometry(0.22, 1);
    geo.scale(1.3, 0.55, 1.1);
    geo.computeVertexNormals();
    return geo;
  },
  angular: () => new THREE.OctahedronGeometry(0.2, 0),
};

const SHAPE_KEYS = Object.keys(PEBBLE_GEOMETRIES);

export default function Pebbles({ transforms, material }) {
  const geometries = useMemo(() => {
    const lib = {};
    Object.entries(PEBBLE_GEOMETRIES).forEach(([key, make]) => {
      lib[key] = make();
    });
    return lib;
  }, []);

  // Fallback material if none provided (though we expect rockMaterial)
  const defaultMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#666660', roughness: 0.85, metalness: 0.0 }), []);

  // Pebbles sit right at the waterline, so lean into wetness/moss/dust streaks
  // rather than the rim lighting that reads better on tall rocks.
  const pebbleMaterial = useMemo(() => {
    const base = (material || defaultMaterial).clone();
    extendRockMaterial(base, {
      mossStrength: 0.45,
      streakStrength: 0.25,
      bandStrength: 0.0,
      dustStrength: 0.3,
      rimStrength: 0.1,
      wetnessRange: 1.2,
    });
    return base;
  }, [material, defaultMaterial]);

  const grouped = useMemo(() => {
    const byShape = { round: [], flat: [], angular: [] };
    if (!transforms) return byShape;

    transforms.forEach((t, i) => {
      const shape = SHAPE_KEYS[i % SHAPE_KEYS.length];
      // Occasional "hero stone": noticeably larger than the surrounding scatter.
      const isHero = i % 17 === 0;
      const heroScale = isHero ? 2.4 : 1;
      const scale = Array.isArray(t.scale)
        ? t.scale.map((s) => s * heroScale)
        : (t.scale?.isVector3
          ? t.scale.clone().multiplyScalar(heroScale)
          : t.scale);

      byShape[shape].push({
        key: `pebble-${i}`,
        position: t.position,
        rotation: t.rotation,
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
