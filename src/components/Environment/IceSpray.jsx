// IceSpray.jsx
// Lightweight ice-crystal spray particle burst for glacier segments.
// Spawns on raft turns and wall grazes. Max 20 particles per segment — perf-first.
// WGSL migration: replace InstancedMesh manual matrix writes with a compute shader
// that writes to a storage buffer read by the vertex stage.

import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const MAX_PARTICLES = 20;
const GRAVITY = -4.5;
const BASE_LIFETIME = 1.0; // seconds

// Shared geometry and material — created once, reused across all IceSpray instances
const SHARED_GEO = new THREE.PlaneGeometry(0.12, 0.12);

// Ice spray colour: nearly-white with a cold blue tint
const ICE_COLOR = new THREE.Color('#c8eeff');

/**
 * IceSpray — billboarded sprite particle burst.
 *
 * Props:
 *   origin   THREE.Vector3  — world-space spawn centre
 *   intensity  0–1          — how many particles to emit (scaled by MAX_PARTICLES)
 *   active   bool           — when false, no new particles spawn
 */
export default function IceSpray({ origin, intensity = 0.5, active = true }) {
  const meshRef = useRef(null);

  // Particle simulation state — kept in plain arrays to avoid React re-renders
  const particles = useRef([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  // InstancedMesh for the spray sprites
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
    // Hide all instances initially
    for (let i = 0; i < MAX_PARTICLES; i++) {
      dummy.position.set(0, -9999, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [dummy]);

  // Spawn a burst of particles at origin whenever intensity changes significantly
  const lastIntensity = useRef(-1);
  const spawnBurst = (count, origin) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.0;
      const upward = 1.0 + Math.random() * 2.5;
      particles.current.push({
        pos: new THREE.Vector3(
          origin.x + (Math.random() - 0.5) * 0.3,
          origin.y + Math.random() * 0.2,
          origin.z + (Math.random() - 0.5) * 0.3,
        ),
        vel: new THREE.Vector3(Math.cos(angle) * speed, upward, Math.sin(angle) * speed),
        life: BASE_LIFETIME * (0.5 + Math.random() * 0.8),
        maxLife: BASE_LIFETIME,
        // Each crystal rotates at a slightly different rate
        rotSpeed: (Math.random() - 0.5) * 4.0,
        rot: Math.random() * Math.PI * 2,
        scale: 0.6 + Math.random() * 0.9,
      });
    }
    // Cap to pool size
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
      if (origin) spawnBurst(count, origin);
    }
  }, [intensity, active, origin]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    // Tick alive particles
    particles.current = particles.current
      .map(p => {
        p.vel.y += GRAVITY * delta;
        p.pos.addScaledVector(p.vel, delta);
        p.rot += p.rotSpeed * delta;
        p.life -= delta;
        return p;
      })
      .filter(p => p.life > 0);

    // Write instance matrices — always write MAX_PARTICLES entries
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles.current[i];
      if (!p) {
        // Hide unused slot below the world
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0.001);
        dummy.rotation.set(0, 0, 0);
      } else {
        dummy.position.copy(p.pos);
        // Billboard: always face camera
        dummy.quaternion.copy(state.camera.quaternion);
        dummy.rotation.z += p.rot;
        const lifeFrac = p.life / p.maxLife;
        dummy.scale.setScalar(p.scale * lifeFrac);
      }
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Fade opacity via instance colour alpha (encoded in colour.r = alpha)
      if (p) {
        const lifeFrac = p.life / p.maxLife;
        // Blue-white crystals fade from bright → dim as they age
        color.set(ICE_COLOR).lerp(new THREE.Color('#ffffff'), 1 - lifeFrac);
        meshRef.current.setColorAt(i, color);
      }
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return <primitive ref={meshRef} object={instancedMesh} />;
}
