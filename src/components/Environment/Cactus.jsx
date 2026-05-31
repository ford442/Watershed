import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';

const hash = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export default function Cactus({ transforms }) {
  const safeTransforms = Array.isArray(transforms) ? transforms : [];

  const barrelGeometry = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.18, 0.22, 0.7, 10);
    geo.translate(0, 0.35, 0);
    geo.computeVertexNormals();
    return geo;
  }, []);

  const padGeometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.22, 10, 8);
    geo.scale(1, 0.35, 0.9);
    geo.computeVertexNormals();
    return geo;
  }, []);

  const spineGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(0.015, 0.09, 1, 1);
    geo.translate(0, 0.045, 0);
    return geo;
  }, []);

  const barrelMaterial = useMemo(() => (
    new THREE.MeshStandardMaterial({
      color: '#4a7c59',
      roughness: 0.9,
      metalness: 0,
    })
  ), []);

  const padMaterial = useMemo(() => (
    new THREE.MeshStandardMaterial({
      color: '#5d8f5a',
      roughness: 0.86,
      metalness: 0,
    })
  ), []);

  const spineMaterial = useMemo(() => (
    new THREE.MeshStandardMaterial({
      color: '#b5c3a3',
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  ), []);

  const instances = useMemo(() => safeTransforms.map((transform, index) => {
    const position = transform.position;
    const rotation = transform.rotation;
    const scale = transform.scale;
    const seed = position.x * 0.33 + position.z * 0.17 + index * 1.91;
    const padOffset = new THREE.Vector3(
      (hash(seed + 0.7) - 0.5) * 0.24,
      0.45 + hash(seed + 1.3) * 0.2,
      (hash(seed + 2.1) - 0.5) * 0.24
    );
    const padScale = new THREE.Vector3(
      0.9 + hash(seed + 2.9) * 0.35,
      0.9 + hash(seed + 3.7) * 0.25,
      0.9 + hash(seed + 4.5) * 0.35
    );
    const spineYaw = hash(seed + 5.3) * Math.PI * 2;
    return {
      key: `cactus-${index}`,
      position,
      rotation,
      scale,
      padOffset,
      padScale,
      spineYaw,
    };
  }), [safeTransforms]);

  if (!instances.length) return null;

  return (
    <group>
      <Instances geometry={barrelGeometry} material={barrelMaterial} castShadow receiveShadow>
        {instances.map((item) => (
          <Instance
            key={item.key}
            position={item.position}
            rotation={item.rotation}
            scale={item.scale}
          />
        ))}
      </Instances>

      <Instances geometry={padGeometry} material={padMaterial} castShadow receiveShadow>
        {instances.map((item) => (
          <Instance
            key={`${item.key}-pad`}
            position={[
              item.position.x + item.padOffset.x,
              item.position.y + item.padOffset.y,
              item.position.z + item.padOffset.z,
            ]}
            rotation={[Math.PI / 2, item.spineYaw, 0]}
            scale={[
              item.scale.x * item.padScale.x,
              item.scale.y * item.padScale.y,
              item.scale.z * item.padScale.z,
            ]}
          />
        ))}
      </Instances>

      <Instances geometry={spineGeometry} material={spineMaterial} receiveShadow>
        {instances.map((item) => (
          <Instance
            key={`${item.key}-spine`}
            position={[
              item.position.x,
              item.position.y + 0.56 * item.scale.y,
              item.position.z,
            ]}
            rotation={[0, item.spineYaw, 0]}
            scale={[item.scale.x, item.scale.y, item.scale.z]}
          />
        ))}
      </Instances>
    </group>
  );
}
