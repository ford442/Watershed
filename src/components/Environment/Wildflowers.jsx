import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { mergeBufferGeometries } from 'three-stdlib';
import { getBiomePalette } from '../../configs/BiomePalettes';

const FLOWER_VARIANTS = ['bloom', 'spike', 'daisy', 'bell'];

const buildCrossPetals = (width, height, y, count = 3) => {
  const geometries = [];
  for (let i = 0; i < count; i++) {
    const petal = new THREE.PlaneGeometry(width, height);
    petal.translate(0, y, 0);
    petal.rotateY((Math.PI / count) * i);
    geometries.push(petal);
  }
  return geometries;
};

export default function Wildflowers({ transforms, biome = 'summer' }) {
  const flowerRefs = useRef({});

  const variants = useMemo(() => {
    const bloom = new THREE.IcosahedronGeometry(0.4, 0);
    bloom.scale(1, 0.8, 1);
    bloom.translate(0, 0.3, 0);
    bloom.computeVertexNormals();

    const spikeStem = new THREE.CylinderGeometry(0.03, 0.05, 0.95, 5).translate(0, 0.47, 0);
    const spikePetals = buildCrossPetals(0.22, 0.55, 0.95, 3);
    const spike = [spikeStem, ...spikePetals];

    const daisyStem = new THREE.CylinderGeometry(0.03, 0.04, 0.45, 5).translate(0, 0.22, 0);
    const daisyBlossoms = [
      ...buildCrossPetals(0.24, 0.18, 0.42, 2),
      ...buildCrossPetals(0.22, 0.16, 0.35, 2).map((geo) => geo.translate(0.16, 0, 0)),
      ...buildCrossPetals(0.2, 0.15, 0.33, 2).map((geo) => geo.translate(-0.14, 0, 0.08)),
    ];
    const daisy = [daisyStem, ...daisyBlossoms];

    const bellStem = new THREE.CylinderGeometry(0.03, 0.05, 0.75, 5).translate(0, 0.36, 0);
    const bellBlossoms = [
      new THREE.ConeGeometry(0.12, 0.22, 5).rotateZ(Math.PI / 4.4).translate(0.14, 0.62, 0),
      new THREE.ConeGeometry(0.1, 0.2, 5).rotateZ(-Math.PI / 4.8).translate(-0.12, 0.55, 0.05),
      new THREE.ConeGeometry(0.1, 0.18, 5).rotateX(Math.PI / 7).translate(0.03, 0.5, -0.1),
    ];
    const bell = [bellStem, ...bellBlossoms];

    return [
      { type: 'bloom', geometry: bloom, swayAmount: 0.025 },
      { type: 'spike', geometry: mergeBufferGeometries(spike), swayAmount: 0.05 },
      { type: 'daisy', geometry: mergeBufferGeometries(daisy), swayAmount: 0.03 },
      { type: 'bell', geometry: mergeBufferGeometries(bell), swayAmount: 0.04 },
    ];
  }, []);

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.88,
        metalness: 0,
        side: THREE.DoubleSide,
    });
  }, []);

  const instancesByVariant = useMemo(() => {
    if (!transforms) return {};

    const grouped = {
      bloom: [],
      spike: [],
      daisy: [],
      bell: [],
    };
    const palette = getBiomePalette(biome).wildflowerColors;

    transforms.forEach((t, i) => {
      const variant = grouped[t.variant] ? t.variant : 'bloom';
      const paletteIndex = t.colorIndex ?? (i % palette.length);
      const color = new THREE.Color(palette[paletteIndex % palette.length]);
      const hueJitter = (t.hueJitter ?? 0) * 0.08;
      const lightnessJitter = (t.lightnessJitter ?? 0) * (biome === 'autumn' ? 0.05 : 0.09);
      color.offsetHSL(hueJitter, biome === 'autumn' ? -0.1 : 0.04, lightnessJitter);

      grouped[variant].push({
        key: `flower-${i}`,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
        color,
      });
    });

    return grouped;
  }, [transforms, biome]);

  useFrame((state) => {
    variants.forEach((variant, index) => {
      const ref = flowerRefs.current[variant.type];
      if (!ref) return;
      ref.rotation.z = Math.sin(state.clock.elapsedTime * 1.8 + index * 0.7) * variant.swayAmount;
    });
  });

  if (!transforms || transforms.length === 0) return null;

  return (
    <group>
      {variants.map((variant) => {
        const instances = instancesByVariant[variant.type] || [];
        if (instances.length === 0) return null;

        return (
          <group
            key={variant.type}
            ref={(node) => {
              if (node) flowerRefs.current[variant.type] = node;
              else delete flowerRefs.current[variant.type];
            }}
          >
            <Instances range={instances.length} geometry={variant.geometry} material={material} receiveShadow>
              {instances.map((data) => (
                <Instance
                  key={data.key}
                  position={data.position}
                  rotation={data.rotation}
                  scale={data.scale}
                  color={data.color}
                />
              ))}
            </Instances>
          </group>
        );
      })}
    </group>
  );
}
