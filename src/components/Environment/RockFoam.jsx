import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';

export default function RockFoam({ transforms, flowSpeed = 1.0 }) {
  // Geometry: Plane (1x1)
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        time: { value: 0 },
        flowSpeed: { value: flowSpeed },
        colorBase: { value: new THREE.Color('#e0f7fa') },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float flowSpeed;
        uniform vec3 colorBase;
        varying vec2 vUv;

        // Simple Noise
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f*f*(3.0-2.0*f);
            return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), f.x),
                       mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), f.x), f.y);
        }

        void main() {
          // Circular Mask
          float dist = distance(vUv, vec2(0.5));
          float mask = smoothstep(0.5, 0.0, dist);
          mask = pow(mask, 2.0);

          // Scrolling Noise
          float flow = time * flowSpeed;

          float n1 = noise(vUv * 8.0 + vec2(0.0, -flow * 2.0));
          float n2 = noise(vUv * 3.0 + vec2(0.0, -flow * 0.8));

          float foam = n1 * 0.6 + n2 * 0.4;
          foam = smoothstep(0.3, 0.9, foam);

          float alpha = mask * foam * 0.6;

          gl_FragColor = vec4(colorBase, alpha);
        }
      `
    });
    return mat;
  }, [flowSpeed]);

  useFrame((state) => {
     if (material.uniforms) {
         material.uniforms.time.value = state.clock.elapsedTime;
     }
  });

  if (!transforms || transforms.length === 0) return null;

  return (
    <Instances geometry={geometry} material={material}>
        {transforms.map((t, i) => (
            <Instance
                key={i}
                position={t.position}
                rotation={t.rotation}
                scale={t.scale}
            />
        ))}
    </Instances>
  );
}
