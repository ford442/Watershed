import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SurfaceMaterial } from '../systems/vehicle/VehicleSystem';
import { createRng } from '../math/random';
import { ParticlePool, writeParticleInstances } from './particlePool';

/** This module's seeded stream (#503 A): draws are reproducible run to run. */
const random = createRng(0x1b54776f);

interface BurstStyle {
  colors: readonly THREE.Color[];
  sizeRange: readonly [number, number];
  velocityScale: number;
  gravity: number;
}

/**
 * Per-material collision bursts:
 * ROCK sparks (orange/white), MOSS leaf debris, WOOD splinters, CONCRETE dust,
 * WATER droplets.
 */
const BURST_STYLE: Record<SurfaceMaterial, BurstStyle> = {
  [SurfaceMaterial.ROCK]: {
    colors: ['#ffaa00', '#ffffff', '#ff6600'].map((c) => new THREE.Color(c)),
    sizeRange: [0.02, 0.06],
    velocityScale: 3,
    gravity: -9.8,
  },
  [SurfaceMaterial.MOSS]: {
    colors: ['#4a7c2a', '#6b8c3a', '#3a5c1a'].map((c) => new THREE.Color(c)),
    sizeRange: [0.03, 0.08],
    velocityScale: 2,
    gravity: -5,
  },
  [SurfaceMaterial.WOOD]: {
    colors: ['#8b7355', '#a08060', '#6b5344'].map((c) => new THREE.Color(c)),
    sizeRange: [0.02, 0.07],
    velocityScale: 2.5,
    gravity: -7,
  },
  [SurfaceMaterial.CONCRETE]: {
    colors: ['#888888', '#aaaaaa', '#666666'].map((c) => new THREE.Color(c)),
    sizeRange: [0.01, 0.04],
    velocityScale: 1.5,
    gravity: -3,
  },
  [SurfaceMaterial.WATER]: {
    colors: ['#aaddff', '#ffffff', '#88ccff'].map((c) => new THREE.Color(c)),
    sizeRange: [0.04, 0.1],
    velocityScale: 2,
    gravity: -4,
  },
};

/** Particles a vehicle's collision pool holds (a max-intensity burst is 30). */
export const COLLISION_PARTICLE_CAPACITY = 128;

/**
 * Visual feedback for a surface collision: 10–30 particles (by `intensity`,
 * 0–1) spawned into `pool` at `position`. Allocation-free.
 */
export function emitCollisionBurst(
  pool: ParticlePool,
  material: SurfaceMaterial,
  position: { x: number; y: number; z: number },
  intensity: number,
): void {
  const style = BURST_STYLE[material] ?? BURST_STYLE[SurfaceMaterial.ROCK];
  const count = Math.floor(10 + intensity * 20);
  for (let i = 0; i < count; i += 1) {
    const color = style.colors[Math.floor(random() * style.colors.length)];
    const angle = random() * Math.PI * 2;
    const elevation = random() * Math.PI * 0.5;
    const speed = (0.5 + random() * 0.5) * style.velocityScale * intensity;
    pool.spawn({
      x: position.x + (random() - 0.5) * 0.2,
      y: position.y + (random() - 0.5) * 0.2,
      z: position.z + (random() - 0.5) * 0.2,
      vx: Math.cos(angle) * Math.sin(elevation) * speed,
      vy: Math.cos(elevation) * speed * 0.8 + 0.5, // upward bias
      vz: Math.sin(angle) * Math.sin(elevation) * speed,
      life: 0.5 + random() * 0.5,
      size: style.sizeRange[0] + random() * (style.sizeRange[1] - style.sizeRange[0]),
      gravity: style.gravity,
      r: color.r,
      g: color.g,
      b: color.b,
    });
  }
}

interface ParticlePoolMeshProps {
  pool: ParticlePool;
  opacity?: number;
}

/**
 * Steps `pool` and draws it as one InstancedMesh of unit spheres, every frame,
 * without React renders: what the physics code spawns shows up next frame.
 */
export function ParticlePoolMesh({ pool, opacity = 1 }: ParticlePoolMeshProps) {
  const mesh = useMemo(() => {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      transparent: opacity < 1,
      opacity,
      depthWrite: false,
    });
    const instanced = new THREE.InstancedMesh(geometry, material, pool.capacity);
    instanced.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pool.capacity * 3), 3);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Particles roam the whole scene; the cached bounds would be stale.
    instanced.frustumCulled = false;
    instanced.count = 0;
    return instanced;
  }, [pool, opacity]);

  useEffect(() => () => {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);

  useFrame((_, delta) => {
    pool.step(Math.min(delta, 0.1));
    writeParticleInstances(pool, mesh);
  });

  return <primitive object={mesh} />;
}
