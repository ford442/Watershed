import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';

export default function Grass({ transforms }) {
  // Geometry: Low poly bush (Icosahedron)
  const geometry = useMemo(() => {
    // Create a slightly irregular bush shape by merging 2 shapes or just one
    // Simple low-poly sphere (Icosahedron with detail 0)
    const geo = new THREE.IcosahedronGeometry(1, 0);

    // Squish it a bit to be more bush-like (wider than tall)
    geo.scale(1, 0.7, 1);

    // Move base to origin so it sits on the ground
    geo.translate(0, 0.5, 0);

    geo.computeVertexNormals();
    return geo;
  }, []);

  // Material: Stylized green
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
        color: '#5a7d38', // Muted organic green
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

            // Wind Animation
            float windStrength = 0.1;
            float windSpeed = 2.0;

            // Height factor: anchor at bottom (near 0)
            float heightFactor = max(0.0, transformed.y - 0.2);
            float windFactor = heightFactor;

            // Simple sway
            float swayX = sin(time * windSpeed + transformed.y * 2.0) * windStrength * windFactor;
            float swayZ = cos(time * windSpeed * 0.9 + transformed.y * 2.0) * windStrength * windFactor;

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
    return transforms.map((t, i) => {
        // Random shade variation per bush
        const shade = 0.8 + Math.random() * 0.4;
        const color = new THREE.Color('#5a7d38').multiplyScalar(shade);
        return {
            key: `grass-${i}`,
            position: t.position,
            rotation: t.rotation,
            scale: t.scale,
            color
        };
    });
  }, [transforms]);

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
