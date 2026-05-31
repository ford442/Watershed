import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';

const LAYERS = [
  { depthOffset: -120, desaturation: 0.4, opacity: 0.72, width: 420, heightVariance: 5.2, rimY: 28 },
  { depthOffset: -220, desaturation: 0.8, opacity: 0.45, width: 520, heightVariance: 6.8, rimY: 30 },
  { depthOffset: -350, desaturation: 0.95, opacity: 0.2, width: 680, heightVariance: 8.0, rimY: 33 },
];

const hash = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

function createRidgelineGeometry(seed, width, heightVariance) {
  const segCount = 14;
  const positions = [];
  const indices = [];
  const halfWidth = width * 0.5;
  const step = width / segCount;
  const floorY = -22;

  for (let i = 0; i <= segCount; i++) {
    const x = -halfWidth + i * step;
    const harmonicA = Math.sin(i * 0.63 + seed) * heightVariance;
    const harmonicB = Math.sin(i * 1.27 + seed * 1.9) * (heightVariance * 0.4);
    const jitter = (hash(seed + i * 2.7) - 0.5) * heightVariance * 0.25;
    const h = harmonicA + harmonicB + jitter;

    positions.push(x, h, 0);
    positions.push(x, floorY, 0);
  }

  for (let i = 0; i < segCount; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export default function CanyonBackground({ segmentId, segmentCenter, baseColor = '#9f5c2a' }) {
  const safeCenter = segmentCenter || new THREE.Vector3();

  const layers = useMemo(() => {
    const fogColor = new THREE.Color('#d8cfc4');
    return LAYERS.map((layer, index) => {
      const seed = segmentId * 3.7 + index * 11.3;
      const geometry = createRidgelineGeometry(seed, layer.width, layer.heightVariance);

      const color = new THREE.Color(baseColor);
      color.lerp(fogColor, layer.desaturation);
      color.offsetHSL(0, -0.08 * layer.desaturation, 0.1 * layer.desaturation);

      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: layer.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      return { ...layer, geometry, material };
    });
  }, [baseColor, segmentId]);

  useEffect(() => {
    return () => {
      layers.forEach((layer) => {
        layer.geometry.dispose();
        layer.material.dispose();
      });
    };
  }, [layers]);

  return (
    <group renderOrder={-30}>
      {layers.map((layer, index) => (
        <mesh
          key={`bg-layer-${index}`}
          geometry={layer.geometry}
          material={layer.material}
          position={[safeCenter.x, layer.rimY, safeCenter.z + layer.depthOffset]}
          renderOrder={-30 + index}
        />
      ))}
    </group>
  );
}
