import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { useTreeAssets } from './TreeAssets';
import { useFrame } from '@react-three/fiber';
import { extendTreeMaterial, updateTreeMaterial } from '../../utils/TreeShader';
import { WATER_LEVEL } from '../../constants/game';

// Warm backlight tints used for the foliage SSS/translucency approximation
const SSS_TINTS = {
  summer: '#dff0a8',
  autumn: '#ffd27a',
};

// Color Palettes
const PALETTES = {
  summer: ['#2d4c1e', '#228b22', '#556b2f', '#1e3312'],
  autumn: ['#d35400', '#e67e22', '#f1c40f', '#c0392b', '#8e44ad', '#dbc632']
};

const RIM_PALETTES = {
  summer: ['#1c2518', '#1f2b1b', '#233321'],
  autumn: ['#2a1e17', '#33261e', '#3d3027'],
  slotCanyon: ['#1a1714', '#211d19', '#27221e'],
};

export default function Vegetation({ transforms, biome = 'summer', isRim = false }) {
  const { variants } = useTreeAssets();
  const safeTransforms = Array.isArray(transforms) ? transforms : [];

  const instancesBySpecies = useMemo(() => {
    // Select palette based on biome, default to summer if invalid
    const palette = isRim
      ? (biome === 'slotCanyon' ? RIM_PALETTES.slotCanyon : (RIM_PALETTES[biome] || RIM_PALETTES.summer))
      : (PALETTES[biome] || PALETTES.summer);

    const grouped = {
      conifer: [],
      broadleaf: [],
      birch: [],
      snag: [],
    };

    safeTransforms.forEach((t, i) => {
      const colorHex = palette[i % palette.length];
      const color = new THREE.Color(colorHex);
      const shadeSeed = (t.speciesIndex ?? i) * 31 + i * 17;
      const shade = 0.82 + (shadeSeed % 19) / 100;
      const species = grouped[t.species] ? t.species : 'conifer';

      if (species === 'snag') {
        color.lerp(new THREE.Color('#8c7866'), 0.65);
      } else if (species === 'birch') {
        color.lerp(new THREE.Color('#eef3dd'), 0.55);
      } else if (species === 'broadleaf') {
        color.lerp(new THREE.Color('#ffd0a2'), biome === 'autumn' ? 0.35 : 0.15);
      }

      color.multiplyScalar(shade);

      grouped[species].push({
        key: `veg-${i}`,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
        color,
      });
    });

    return grouped;
  }, [safeTransforms, biome, isRim]);

  const speciesMaterials = useMemo(() => {
    const sssColor = SSS_TINTS[biome] || SSS_TINTS.summer;
    const map = {};
    variants.forEach((variant) => {
      const material = new THREE.MeshStandardMaterial({
        color: variant.baseTint,
        roughness: variant.type === 'snag' ? 0.96 : 0.86,
        metalness: 0,
        vertexColors: true,
      });
      extendTreeMaterial(material, {
        windStrength: variant.swayAmount * 1.6,
        windSpeed: 1.35,
        sssColor,
        sssStrength: variant.type === 'snag' ? 0 : 0.35,
        waterLevel: WATER_LEVEL,
        rustleRadius: 6.0,
        rustleStrength: 2.5,
      });
      map[variant.type] = material;
    });
    return map;
  }, [variants, biome]);

  // Per-vertex wind sway, leaf flutter, player rustle + foliage backlight, driven by TreeShader
  useFrame((state) => {
    variants.forEach((variant) => {
      updateTreeMaterial(speciesMaterials[variant.type], state.clock.elapsedTime, state.camera.position);
    });
  });

  if (safeTransforms.length === 0) return null;

  return (
    <group>
      {variants.map((variant) => {
        const instances = instancesBySpecies[variant.type] || [];
        if (instances.length === 0) return null;

        return (
          <group key={variant.type}>
            <Instances
              range={instances.length}
              geometry={variant.geometry}
              material={speciesMaterials[variant.type]}
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
