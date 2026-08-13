import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useLOD } from '../../systems/LODManager';
import type { WaterfallParticlesProps } from './types';

interface WaterfallParticle {
  x: number;
  y: number;
  z: number;
  speed: number;
  scale: number;
  initialY: number;
  vx: number;
  vz: number;
  active: boolean;
}

const MAX_POOL = 500;

export default function WaterfallParticles({
  count: baseCount = 300,
  width = 15,
  height = 25,
  playerVelocity = 0,
  particleDensity = 1.0,
  fanAngle = 0,
}: WaterfallParticlesProps) {
  const fanSpreadRad = (fanAngle * Math.PI) / 180;
  const { config: lodConfig } = useLOD();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const currentCountRef = useRef(baseCount);
  const targetCountRef = useRef(baseCount);
  const fadeAlphaRef = useRef(1.0);

  const calculatedCount = useMemo(() => {
    const densityBase = 100 + (particleDensity * 300);
    let velocityMultiplier = 1.0;
    if (playerVelocity > 20) {
      velocityMultiplier = 1.5;
    }

    let lodMultiplier = 1.0;
    const maxParticles = lodConfig?.maxParticles ?? 500;
    if (maxParticles <= 200) {
      lodMultiplier = 0.25;
    } else if (maxParticles <= 500) {
      lodMultiplier = 0.6;
    }

    let finalCount = Math.floor(densityBase * velocityMultiplier * lodMultiplier);
    const absoluteMax = maxParticles <= 200 ? 100 : 500;
    finalCount = Math.min(absoluteMax, finalCount);

    return finalCount;
  }, [baseCount, particleDensity, playerVelocity, lodConfig]);

  useEffect(() => {
    targetCountRef.current = calculatedCount;
  }, [calculatedCount]);

  const particles = useMemo((): WaterfallParticle[] => {
    const temp: WaterfallParticle[] = [];
    for (let i = 0; i < MAX_POOL; i++) {
      const x = (Math.random() - 0.5) * width;
      const y = Math.random() * height;
      const z = (Math.random() - 0.5) * 5;
      const speed = 0.2 + Math.random() * 0.3;
      const scale = 0.5 + Math.random() * 0.5;
      const randomAngle = (Math.random() - 0.5) * fanSpreadRad;
      const vx = fanSpreadRad > 0 ? Math.sin(randomAngle) * speed * 1.5 : 0;
      const vz = fanSpreadRad > 0 ? Math.cos(randomAngle) * speed * 0.3 : 0;

      temp.push({
        x, y, z, speed, scale, initialY: y, vx, vz,
        active: i < baseCount,
      });
    }
    return temp;
  }, [width, height, baseCount, fanSpreadRad]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(0.8, 0.8), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#e0f7fa',
    transparent: true,
    opacity: 0.6,
    roughness: 0.1,
    emissive: '#aaddff',
    emissiveIntensity: 0.5,
    side: THREE.DoubleSide,
  }), []);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const countDiff = targetCountRef.current - currentCountRef.current;
    if (Math.abs(countDiff) > 1) {
      const change = Math.sign(countDiff) * Math.min(50, Math.abs(countDiff) * delta * 5);
      currentCountRef.current += change;
    } else {
      currentCountRef.current = targetCountRef.current;
    }

    const currentCount = Math.floor(currentCountRef.current);

    if (playerVelocity < 1.0) {
      fadeAlphaRef.current -= delta * 0.5;
      if (fadeAlphaRef.current < 0) fadeAlphaRef.current = 0;
    } else {
      fadeAlphaRef.current += delta * 2;
      if (fadeAlphaRef.current > 1) fadeAlphaRef.current = 1;
    }

    const meshMaterial = mesh.material;
    if (meshMaterial instanceof THREE.MeshStandardMaterial) {
      meshMaterial.opacity = 0.6 * fadeAlphaRef.current;
    }

    particles.forEach((p, i) => {
      if (i < currentCount) {
        p.y -= p.speed;
        if (p.vx) p.x += p.vx;
        if (p.vz) p.z += p.vz;

        if (p.y < 0) {
          p.y = height;
          p.x = (Math.random() - 0.5) * width;
          p.z = (Math.random() - 0.5) * 5;
        }

        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.scale * fadeAlphaRef.current);
        dummy.rotation.x += 0.05;

        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      } else {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    });

    mesh.instanceMatrix.needsUpdate = true;

    const light = lightRef.current;
    if (light) {
      const intensityScale = currentCount / 300;
      light.intensity = (2 + Math.sin(state.clock.elapsedTime * 10) * 0.5) * intensityScale;
      light.intensity *= fadeAlphaRef.current;
    }
  });

  return (
    <group position={[0, -height / 2, 0]}>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, MAX_POOL]}
        frustumCulled={false}
      />
      <pointLight
        ref={lightRef}
        distance={20}
        color="#aaddff"
        decay={2}
        intensity={2}
      />
    </group>
  );
}
