import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { mergeBufferGeometries } from 'three-stdlib';
import { extendVegetationMaterial, updateVegetationMaterial } from '../../utils/VegetationShader';

const BASE_COLORS = {
  default: '#4e7336',
  slotCanyon: '#c8a86e',
};

const TIP_COLORS = {
  default: '#9bcf5a',
  slotCanyon: '#e0c98a',
};

const hash = (n) => {
  const x = Math.sin(n * 7.531) * 43758.5453;
  return x - Math.floor(x);
};

// Build a single tapered grass blade card, base at origin, tip at y = height.
const buildBlade = (height, width, curve, baseColor, tipColor) => {
  const geo = new THREE.PlaneGeometry(width, height, 1, 4);
  geo.translate(0, height / 2, 0);

  const positions = geo.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const t = THREE.MathUtils.clamp(y / height, 0, 1);

    // Taper toward the tip
    positions.setX(i, x * (1 - t * 0.85));
    // Gentle bend toward the tip
    positions.setZ(i, -Math.pow(t, 2) * curve);

    // Vertex color gradient: darker base, brighter sun-catching tip
    c.copy(baseColor).lerp(tipColor, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
};

export default function Grass({ transforms, biome = 'summer' }) {
  const grassRef = useRef(null);
  const baseColor = biome === 'slotCanyon' ? BASE_COLORS.slotCanyon : BASE_COLORS.default;
  const tipColor = biome === 'slotCanyon' ? TIP_COLORS.slotCanyon : TIP_COLORS.default;

  // Geometry: 3 crossed tapered blade cards, individually wind-animated
  const geometry = useMemo(() => {
    const base = new THREE.Color(baseColor);
    const tip = new THREE.Color(tipColor);

    const blades = [
      buildBlade(1.0, 0.16, 0.18, base, tip),
      buildBlade(0.85, 0.14, 0.22, base, tip).rotateY(Math.PI / 3),
      buildBlade(0.95, 0.15, 0.15, base, tip).rotateY(-Math.PI / 3),
    ];

    const merged = mergeBufferGeometries(blades) || blades[0];
    merged.computeVertexNormals();
    return merged;
  }, [baseColor, tipColor]);

  // Material: vertex-colored, with per-blade wind sway
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    extendVegetationMaterial(mat, { plantHeight: 1.0, windStrength: 0.07, windSpeed: 1.6 });
    return mat;
  }, []);

  useFrame((state) => {
    updateVegetationMaterial(material, state.clock.elapsedTime);
  });

  const instances = useMemo(() => {
    if (!transforms) return [];
    return transforms.map((t, i) => {
        const seed = t.position.x * 0.31 + t.position.z * 0.19 + i * 1.17;
        const shade = 0.85 + hash(seed) * 0.3;
        return {
            key: `grass-${i}`,
            position: t.position,
            rotation: t.rotation,
            scale: t.scale,
            color: new THREE.Color(0xffffff).multiplyScalar(shade),
        };
    });
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <Instances ref={grassRef} range={instances.length} geometry={geometry} material={material} receiveShadow>
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
