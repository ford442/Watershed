import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';

const PALETTES = {
  summer: [
      '#e91e63', // Pink
      '#9c27b0', // Purple
      '#ffeb3b', // Yellow
      '#ffffff', // White
      '#2196f3', // Blue
      '#ff5722'  // Orange
  ],
  autumn: [
      '#795548', // Brown
      '#a1887f', // Light Brown
      '#d7ccc8'  // Beige
  ]
};

export default function Wildflowers({ transforms, biome = 'summer' }) {
  // Geometry: Low poly flower clump
  const geometry = useMemo(() => {
    // Simple low-poly sphere (Icosahedron with detail 0)
    // Smaller than grass
    const geo = new THREE.IcosahedronGeometry(0.4, 0);

    // Squish it a bit to be more bush-like
    geo.scale(1, 0.8, 1);

    // Move base to origin
    geo.translate(0, 0.3, 0);

    geo.computeVertexNormals();
    return geo;
  }, []);

  // Material: Vibrant Colors
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
        color: '#ffffff', // Use white so instance color tints it
        roughness: 1.0,
        flatShading: true,
    });

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

            // Wind Animation (Slightly faster/lighter than grass)
            float windStrength = 0.15;
            float windSpeed = 3.0;

            // Height factor: anchor at bottom
            float heightFactor = max(0.0, transformed.y - 0.1);
            float windFactor = heightFactor;

            // Complex sway for flowers
            float swayX = sin(time * windSpeed + transformed.y * 4.0) * windStrength * windFactor;
            float swayZ = cos(time * windSpeed * 1.2 + transformed.y * 4.0) * windStrength * windFactor;

            transformed.x += swayX;
            transformed.z += swayZ;
            `
        );
    };

    return mat;
  }, []);

  useFrame((state) => {
      if (material.userData.uniforms) {
          material.userData.uniforms.time.value = state.clock.elapsedTime;
      }
  });

  const instances = useMemo(() => {
    if (!transforms) return [];

    // Select palette
    const palette = PALETTES[biome] || PALETTES.summer;
    // For autumn, significantly reduce count or make them look dead
    // We handle "reduction" in TrackSegment by not spawning them or filtering here.
    // Assuming TrackSegment passes valid transforms for the biome.

    return transforms.map((t, i) => {
        // Random color from palette
        const colorHex = palette[Math.floor(Math.random() * palette.length)];
        const color = new THREE.Color(colorHex);

        // Slight variation
        if (biome === 'summer') {
             // Make some more vibrant
             color.offsetHSL(0, (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.1);
        } else {
             // Make autumn more dull
             color.offsetHSL(0, -0.2, 0);
        }

        return {
            key: `flower-${i}`,
            position: t.position,
            rotation: t.rotation,
            scale: t.scale,
            color
        };
    });
  }, [transforms, biome]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <Instances range={instances.length} geometry={geometry} material={material} receiveShadow>
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
}
