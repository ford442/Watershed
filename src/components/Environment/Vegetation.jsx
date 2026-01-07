import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { InstancedRigidBodies } from '@react-three/rapier';
import { useTreeAssets } from './TreeAssets';

// Color Palettes
const PALETTES = {
  summer: ['#2d4c1e', '#228b22', '#556b2f', '#1e3312'],
  autumn: ['#d35400', '#e67e22', '#f1c40f', '#c0392b', '#8e44ad', '#dbc632']
};

export default function Vegetation({ transforms, biome = 'summer' }) {
  const { trunkGeometry, foliageGeometry } = useTreeAssets();

  // Materials
  const trunkMaterial = useMemo(() =>
    new THREE.MeshStandardMaterial({
      color: '#4a3c31',
      roughness: 0.9
    }), []
  );

  const foliageMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff', // Use white so instance color tints it correctly
      roughness: 0.8,
      flatShading: true
    });

    // Custom Shader for Wind Animation
    mat.userData.uniforms = {
        time: { value: 0 }
    };

    mat.onBeforeCompile = (shader) => {
        shader.uniforms.time = mat.userData.uniforms.time;

        shader.vertexShader = `
            uniform float time;
        ` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>

            // Wind Animation
            float windStrength = 0.15;
            float windSpeed = 1.5;

            // Apply wind only above a certain height (keep base attached)
            // Foliage starts around Y=1.0
            float heightFactor = max(0.0, transformed.y - 1.0);
            float windFactor = heightFactor * heightFactor; // Non-linear bend

            // Simple sway based on time and height
            // Using local position Y for phase to make it ripple slightly
            float swayX = sin(time * windSpeed + transformed.y * 0.5) * windStrength * windFactor;
            float swayZ = cos(time * windSpeed * 0.7 + transformed.y * 0.5) * windStrength * windFactor;

            transformed.x += swayX;
            transformed.z += swayZ;
            `
        );
    };

    return mat;
  }, []);

  // Update time uniform
  useFrame((state) => {
    if (foliageMaterial.userData.uniforms) {
        foliageMaterial.userData.uniforms.time.value = state.clock.elapsedTime;
    }
  });

  const instances = useMemo(() => {
    // Select palette based on biome, default to summer if invalid
    const palette = PALETTES[biome] || PALETTES.summer;

    return transforms.map((t, i) => {
      // Pick a random color from the palette
      const colorHex = palette[Math.floor(Math.random() * palette.length)];
      const color = new THREE.Color(colorHex);

      // Add slight brightness variation
      const shade = 0.8 + Math.random() * 0.4;
      color.multiplyScalar(shade);

      return {
        key: `veg-${i}`,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
        color: color
      };
    });
  }, [transforms, biome]);

  if (transforms.length === 0) return null;

  return (
    <group>
      {/* TRUNKS */}
      <InstancedRigidBodies
        instances={instances}
        type="fixed"
        colliders="hull"
      >
        <Instances range={instances.length} geometry={trunkGeometry} material={trunkMaterial}>
          {instances.map((t) => (
            <Instance
              key={t.key}
              position={t.position}
              rotation={t.rotation}
              scale={t.scale}
            />
          ))}
        </Instances>
      </InstancedRigidBodies>

      {/* FOLIAGE */}
      <Instances range={instances.length} geometry={foliageGeometry} material={foliageMaterial}>
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
}
