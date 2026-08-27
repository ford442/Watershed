import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { useTreeAssets } from './TreeAssets';
import { useFrame } from '@react-three/fiber';
import { createTreeSurfaceMaterial, updateTreeSurfaceMaterial } from '../../materials/foliage/createFoliageSurfaceMaterial';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import { WATER_LEVEL } from '../../constants/game';
import { isAutumnLike } from '../../configs/biomes';
import type { TreePlacement, VegetationProps } from './types';

type PaletteSeason = 'summer' | 'autumn';
type TreeSpecies = 'conifer' | 'broadleaf' | 'birch' | 'snag';

interface VegetationInstance {
  key: string;
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  scale?: THREE.Vector3;
  color: THREE.Color;
}

const SSS_TINTS: Record<PaletteSeason, string> = {
  summer: '#dff0a8',
  autumn: '#ffd27a',
};

const PALETTES: Record<PaletteSeason, string[]> = {
  summer: ['#2d4c1e', '#228b22', '#556b2f', '#1e3312'],
  autumn: ['#d35400', '#e67e22', '#f1c40f', '#c0392b', '#8e44ad', '#dbc632'],
};

const RIM_PALETTES: Record<PaletteSeason | 'slotCanyon', string[]> = {
  summer: ['#1c2518', '#1f2b1b', '#233321'],
  autumn: ['#2a1e17', '#33261e', '#3d3027'],
  slotCanyon: ['#1a1714', '#211d19', '#27221e'],
};

const DEFAULT_ROTATION = new THREE.Euler();
const DEFAULT_SCALE = new THREE.Vector3(1, 1, 1);

function resolvePaletteSeason(biome: string): PaletteSeason {
  return biome.includes('autumn') ? 'autumn' : 'summer';
}

function resolveSpecies(species: string | undefined): TreeSpecies {
  if (species === 'broadleaf' || species === 'birch' || species === 'snag') return species;
  return 'conifer';
}

export default function Vegetation({ transforms, biome = 'canyonSummer', isRim = false }: VegetationProps) {
  const { variants } = useTreeAssets();
  const safeTransforms = Array.isArray(transforms) ? transforms : [];

  const instancesBySpecies = useMemo(() => {
    const season = resolvePaletteSeason(biome);
    const palette = isRim
      ? (biome === 'slotCanyon' ? RIM_PALETTES.slotCanyon : RIM_PALETTES[season])
      : PALETTES[season];

    const grouped: Record<TreeSpecies, VegetationInstance[]> = {
      conifer: [],
      broadleaf: [],
      birch: [],
      snag: [],
    };

    safeTransforms.forEach((t: TreePlacement, i: number) => {
      const colorHex = palette[i % palette.length] ?? palette[0];
      const color = new THREE.Color(colorHex);
      const shadeSeed = (t.speciesIndex ?? i) * 31 + i * 17;
      const shade = 0.82 + (shadeSeed % 19) / 100;
      const species = resolveSpecies(t.species);

      if (species === 'snag') {
        color.lerp(new THREE.Color('#8c7866'), 0.65);
      } else if (species === 'birch') {
        color.lerp(new THREE.Color('#eef3dd'), 0.55);
      } else if (species === 'broadleaf') {
        color.lerp(new THREE.Color('#ffd0a2'), isAutumnLike(biome) ? 0.35 : 0.15);
      }

      color.multiplyScalar(shade);

      grouped[species].push({
        key: `veg-${i}`,
        position: t.position,
        rotation: t.rotation ?? DEFAULT_ROTATION,
        scale: t.scale ?? DEFAULT_SCALE,
        color,
      });
    });

    return grouped;
  }, [safeTransforms, biome, isRim]);

  const speciesMaterials = useMemo(() => {
    const season = resolvePaletteSeason(biome);
    const sssColor = SSS_TINTS[season];
    const map: Partial<Record<TreeSpecies, THREE.MeshStandardMaterial>> = {};
    variants.forEach((variant) => {
      const material = new THREE.MeshStandardMaterial({
        color: variant.baseTint,
        roughness: variant.type === 'snag' ? 0.96 : 0.86,
        metalness: 0,
        vertexColors: true,
      });
      map[variant.type as TreeSpecies] = createTreeSurfaceMaterial(resolveMaterialBackend().backend, material, {
        windStrength: variant.swayAmount * 1.6,
        windSpeed: 1.35,
        sssColor,
        sssStrength: variant.type === 'snag' ? 0 : 0.35,
        waterLevel: WATER_LEVEL,
        rustleRadius: 6.0,
        rustleStrength: 2.5,
      }) as THREE.MeshStandardMaterial;
    });
    return map;
  }, [variants, biome]);

  useFrame((state) => {
    variants.forEach((variant) => {
      const mat = speciesMaterials[variant.type as TreeSpecies];
      if (mat) {
        updateTreeSurfaceMaterial(mat, state.clock.elapsedTime, state.camera.position);
      }
    });
  });

  if (safeTransforms.length === 0) return null;

  return (
    <group>
      {variants.map((variant) => {
        const instances = instancesBySpecies[variant.type as TreeSpecies] || [];
        if (instances.length === 0) return null;

        const material = speciesMaterials[variant.type as TreeSpecies];
        if (!material) return null;

        return (
          <group key={variant.type}>
            <Instances
              range={instances.length}
              geometry={variant.geometry}
              material={material}
              castShadow
              receiveShadow
            >
              {instances.map((t) => (
                <Instance
                  key={t.key}
                  position={t.position}
                  rotation={t.rotation}
                  scale={t.scale}
                  color={t.color}
                />
              ))}
            </Instances>
          </group>
        );
      })}
    </group>
  );
}
