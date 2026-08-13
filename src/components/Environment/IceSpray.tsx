// IceSpray — lightweight ice-crystal spray particle burst for glacier segments.
import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { IceSprayProps } from './types';

const MAX_PARTICLES = 20;
const GRAVITY = -4.5;
const BASE_LIFETIME = 1.0;

const SHARED_GEO = new THREE.PlaneGeometry(0.12, 0.12);
const ICE_COLOR = new THREE.Color('#c8eeff');

interface IceParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  rotSpeed: number;
  rot: number;
  scale: number;
}

export default function IceSpray({ origin, intensity = 0.5, active = true }: IceSprayProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const particles = useRef<IceParticle[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  const instancedMesh = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: ICE_COLOR,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.InstancedMesh(SHARED_GEO, mat, MAX_PARTICLES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      dummy.position.set(0, -9999, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [dummy]);

  const lastIntensity = useRef(-1);
  const spawnBurst = (count: number, spawnOrigin: THREE.Vector3) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.0;
      const upward = 1.0 + Math.random() * 2.5;
      particles.current.push({
        pos: new THREE.Vector3(
          spawnOrigin.x + (Math.random() - 0.5) * 0.3,
          spawnOrigin.y + Math.random() * 0.2,
          spawnOrigin.z + (Math.random() - 0.5) * 0.3,
        ),
        vel: new THREE.Vector3(Math.cos(angle) * speed, upward, Math.sin(angle) * speed),
        life: BASE_LIFETIME * (0.5 + Math.random() * 0.8),
        maxLife: BASE_LIFETIME,
        rotSpeed: (Math.random() - 0.5) * 4.0,
        rot: Math.random() * Math.PI * 2,
        scale: 0.6 + Math.random() * 0.9,
      });
    }
    if (particles.current.length > MAX_PARTICLES) {
      particles.current.splice(0, particles.current.length - MAX_PARTICLES);
    }
  };

  useEffect(() => {
    if (!active) return;
    const threshold = 0.15;
    if (Math.abs(intensity - lastIntensity.current) > threshold) {
      lastIntensity.current = intensity;
      const count = Math.max(2, Math.round(intensity * MAX_PARTICLES * 0.5));
      spawnBurst(count, origin);
    }
  }, [intensity, active, origin]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    particles.current = particles.current
      .map((p) => {
        p.vel.y += GRAVITY * delta;
        p.pos.addScaledVector(p.vel, delta);
        p.rot += p.rotSpeed * delta;
        p.life -= delta;
        return p;
      })
      .filter((p) => p.life > 0);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles.current[i];
      if (!p) {
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0.001);
        dummy.rotation.set(0, 0, 0);
      } else {
        dummy.position.copy(p.pos);
        dummy.quaternion.copy(state.camera.quaternion);
        dummy.rotation.z += p.rot;
        const lifeFrac = p.life / p.maxLife;
        dummy.scale.setScalar(p.scale * lifeFrac);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      if (p) {
        const lifeFrac = p.life / p.maxLife;
        color.set(ICE_COLOR).lerp(new THREE.Color('#ffffff'), 1 - lifeFrac);
        mesh.setColorAt(i, color);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  });

  return <primitive ref={meshRef} object={instancedMesh} />;
}
