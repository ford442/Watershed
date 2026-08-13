import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import { mergeBufferGeometries } from 'three-stdlib';
import { getBiomePalette } from '../../configs/BiomePalettes';
import { extendVegetationMaterial, updateVegetationMaterial } from '../../utils/VegetationShader';
import { isAutumnLike } from '../../configs/biomes';
import type { BiomeDecorationTransform, BiomeScopedDecorationProps } from './types';
import { toVegetationMaterial } from './types';

const FLOWER_VARIANTS = ['bloom', 'spike', 'daisy', 'bell'] as const;
type FlowerVariant = typeof FLOWER_VARIANTS[number];

interface FlowerInstance {
  key: string;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  color: THREE.Color;
}

const STAMEN_COLOR = new THREE.Color('#f4d35e');
const WHITE = new THREE.Color('#ffffff');
const WILT_COLOR = new THREE.Color('#8a7048');
const DEFAULT_ROTATION = new THREE.Euler();
const DEFAULT_SCALE = new THREE.Vector3(1, 1, 1);

const paintFlat = (geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry => {
  const positions = geo.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
};

const mergeCompatibleGeometries = (geometries: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  if (!geometries.length) return new THREE.BufferGeometry();
  const normalized = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  const attrNames = new Set<string>();
  normalized.forEach((g) => Object.keys(g.attributes).forEach((n) => attrNames.add(n)));
  normalized.forEach((g) => {
    attrNames.forEach((name) => {
      if (!g.getAttribute(name)) {
        const refGeo = normalized.find((h) => h.getAttribute(name));
        const positionAttr = g.getAttribute('position');
        if (!refGeo || !positionAttr) return;
        const ref = refGeo.getAttribute(name);
        g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(positionAttr.count * ref.itemSize), ref.itemSize));
      }
    });
  });
  try {
    return mergeBufferGeometries(normalized) || new THREE.BufferGeometry();
  } catch {
    return new THREE.BufferGeometry();
  }
};

const buildCrossPetals = (width: number, height: number, y: number, count = 3): THREE.BufferGeometry[] => {
  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const petal = new THREE.PlaneGeometry(width, height);
    petal.translate(0, y, 0);
    petal.rotateY((Math.PI / count) * i);
    geometries.push(petal);
  }
  return geometries;
};

function resolveVariant(variant: string | undefined): FlowerVariant {
  if (variant === 'spike' || variant === 'daisy' || variant === 'bell') return variant;
  return 'bloom';
}

export default function Wildflowers({ transforms, biome = 'canyonSummer' }: BiomeScopedDecorationProps) {
  const variants = useMemo(() => {
    const bloomPetals = new THREE.IcosahedronGeometry(0.4, 0);
    bloomPetals.scale(1, 0.8, 1);
    bloomPetals.translate(0, 0.3, 0);
    paintFlat(bloomPetals, WHITE);

    const bloomStamen = new THREE.IcosahedronGeometry(0.1, 1);
    bloomStamen.translate(0, 0.52, 0);
    paintFlat(bloomStamen, STAMEN_COLOR);

    const bloom = mergeCompatibleGeometries([bloomPetals, bloomStamen]);
    bloom.computeVertexNormals();

    const spikeStem = paintFlat(new THREE.CylinderGeometry(0.03, 0.05, 0.95, 5).translate(0, 0.47, 0), WHITE);
    const spikePetals = buildCrossPetals(0.22, 0.55, 0.95, 3).map((geo) => paintFlat(geo, WHITE));
    const spike = [spikeStem, ...spikePetals];

    const daisyStem = paintFlat(new THREE.CylinderGeometry(0.03, 0.04, 0.45, 5).translate(0, 0.22, 0), WHITE);
    const daisyBlossoms = [
      ...buildCrossPetals(0.24, 0.18, 0.42, 2),
      ...buildCrossPetals(0.22, 0.16, 0.35, 2).map((geo) => geo.translate(0.16, 0, 0)),
      ...buildCrossPetals(0.2, 0.15, 0.33, 2).map((geo) => geo.translate(-0.14, 0, 0.08)),
    ].map((geo) => paintFlat(geo, WHITE));
    const daisyStamen = paintFlat(new THREE.SphereGeometry(0.07, 6, 4).translate(0, 0.41, 0), STAMEN_COLOR);
    const daisy = [daisyStem, ...daisyBlossoms, daisyStamen];

    const bellStem = paintFlat(new THREE.CylinderGeometry(0.03, 0.05, 0.75, 5).translate(0, 0.36, 0), WHITE);
    const bellBlossoms = [
      new THREE.ConeGeometry(0.12, 0.22, 5).rotateZ(Math.PI / 4.4).translate(0.14, 0.62, 0),
      new THREE.ConeGeometry(0.1, 0.2, 5).rotateZ(-Math.PI / 4.8).translate(-0.12, 0.55, 0.05),
      new THREE.ConeGeometry(0.1, 0.18, 5).rotateX(Math.PI / 7).translate(0.03, 0.5, -0.1),
    ].map((geo) => paintFlat(geo, WHITE));
    const bell = [bellStem, ...bellBlossoms];

    return [
      { type: 'bloom' as const, geometry: bloom, plantHeight: 0.6, windStrength: 0.05, windSpeed: 1.7 },
      { type: 'spike' as const, geometry: mergeCompatibleGeometries(spike), plantHeight: 1.5, windStrength: 0.07, windSpeed: 1.2 },
      { type: 'daisy' as const, geometry: mergeCompatibleGeometries(daisy), plantHeight: 0.65, windStrength: 0.04, windSpeed: 1.8 },
      { type: 'bell' as const, geometry: mergeCompatibleGeometries(bell), plantHeight: 1.1, windStrength: 0.06, windSpeed: 1.4 },
    ];
  }, []);

  const materials = useMemo(() => {
    const result: Partial<Record<FlowerVariant, THREE.MeshStandardMaterial>> = {};
    variants.forEach((variant) => {
      const mat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
        vertexColors: true,
      });
      extendVegetationMaterial(toVegetationMaterial(mat), {
        plantHeight: variant.plantHeight,
        windStrength: variant.windStrength,
        windSpeed: variant.windSpeed,
      });
      result[variant.type] = mat;
    });
    return result;
  }, [variants]);

  const instancesByVariant = useMemo(() => {
    const grouped: Record<FlowerVariant, FlowerInstance[]> = {
      bloom: [],
      spike: [],
      daisy: [],
      bell: [],
    };
    if (!transforms) return grouped;

    const palette = getBiomePalette(biome).wildflowerColors;

    transforms.forEach((t: BiomeDecorationTransform, i: number) => {
      const variant = resolveVariant(t.variant);
      const paletteIndex = t.colorIndex ?? (i % palette.length);
      const color = new THREE.Color(palette[paletteIndex % palette.length]);
      const hueJitter = (t.hueJitter ?? 0) * 0.08;
      const lightnessJitter = (t.lightnessJitter ?? 0) * (isAutumnLike(biome) ? 0.05 : 0.09);
      color.offsetHSL(hueJitter, isAutumnLike(biome) ? -0.1 : 0.04, lightnessJitter);

      const wiltRoll = ((Math.sin((t.position.x * 12.9898 + t.position.z * 78.233 + i) * 43758.5453) % 1) + 1) % 1;
      const isWilted = wiltRoll < 0.12;
      const baseRotation = t.rotation ?? DEFAULT_ROTATION;
      let rotation = baseRotation;
      if (isWilted) {
        color.lerp(WILT_COLOR, 0.65);
        rotation = new THREE.Euler(
          baseRotation.x + 0.6 + wiltRoll * 0.5,
          baseRotation.y,
          baseRotation.z + (wiltRoll - 0.06) * 0.8,
        );
      }

      grouped[variant].push({
        key: `flower-${i}`,
        position: t.position,
        rotation,
        scale: t.scale ?? DEFAULT_SCALE,
        color,
      });
    });

    return grouped;
  }, [transforms, biome]);

  useFrame((state) => {
    variants.forEach((variant) => {
      const mat = materials[variant.type];
      if (mat) {
        updateVegetationMaterial(toVegetationMaterial(mat), state.clock.elapsedTime);
      }
    });
  });

  if (!transforms || transforms.length === 0) return null;

  return (
    <group>
      {variants.map((variant) => {
        const instances = instancesByVariant[variant.type] || [];
        const material = materials[variant.type];
        if (instances.length === 0 || !material) return null;

        return (
          <Instances key={variant.type} range={instances.length} geometry={variant.geometry} material={material} receiveShadow>
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
        );
      })}
    </group>
  );
}
