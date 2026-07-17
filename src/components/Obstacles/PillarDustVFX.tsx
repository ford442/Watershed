/**
 * PillarDustVFX — dust burst when a crumbling pillar shatters.
 *
 * Uses the same ParticlePool pipeline as SplashSystem; listens for pillarBreak
 * events so Rock columns stay decoupled from the VFX renderer.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ParticlePool, VFXParticle } from '../../systems/ParticlePool';
import { PILLAR_BREAK_EVENT, type PillarBreakEventDetail } from './pillarBreakEvents';

const DUST_POOL_SIZE = 120;
const DUST_POOL_MAX = 400;
const MAX_INSTANCES = 200;

const createDustParticle = (): VFXParticle => new VFXParticle();

export default function PillarDustVFX() {
  const poolRef = useRef<ParticlePool<VFXParticle> | null>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useRef(new THREE.Object3D());
  const hidden = useMemo(() => new THREE.Vector3(0, -9999, 0), []);

  useEffect(() => {
    poolRef.current = new ParticlePool(createDustParticle, DUST_POOL_SIZE, DUST_POOL_MAX);
  }, []);

  const spawnDustBurst = useCallback((point: THREE.Vector3, intensity: number) => {
    const pool = poolRef.current;
    if (!pool) return;

    const count = Math.floor(14 + intensity * 18);
    const particles = pool.acquireMultiple(count);

    particles.forEach((p, i) => {
      p.position.copy(point);
      p.position.x += (Math.random() - 0.5) * 1.2;
      p.position.y += Math.random() * 0.6;
      p.position.z += (Math.random() - 0.5) * 1.2;

      const angle = (i / count) * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      p.velocity.set(
        Math.cos(angle) * speed,
        2 + Math.random() * 3,
        Math.sin(angle) * speed,
      );

      p.maxLife = 0.6 + Math.random() * 0.8;
      p.life = p.maxLife;
      p.scale = 0.25 + Math.random() * 0.35;
      p.color.set('#a08060');
      p.rotationSpeed = (Math.random() - 0.5) * 6;
    });
  }, []);

  useEffect(() => {
    const onPillarBreak = (event: Event) => {
      const detail = (event as CustomEvent<PillarBreakEventDetail>).detail;
      if (!detail?.impactPoint) return;
      const point = new THREE.Vector3(detail.impactPoint.x, detail.impactPoint.y, detail.impactPoint.z);
      const intensity = Math.min(1, detail.impactSpeed / 20);
      spawnDustBurst(point, intensity);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('camera-rumble', {
          detail: { intensity: 0.35 + intensity * 0.45 },
        }));
        window.dispatchEvent(new CustomEvent('collision-sound', {
          detail: {
            material: 'rock',
            force: 12 + intensity * 10,
            point,
          },
        }));
      }
    };

    window.addEventListener(PILLAR_BREAK_EVENT, onPillarBreak);
    return () => window.removeEventListener(PILLAR_BREAK_EVENT, onPillarBreak);
  }, [spawnDustBurst]);

  useFrame((_, delta) => {
    const pool = poolRef.current;
    const mesh = meshRef.current;
    if (!pool || !mesh) return;

    const active = pool.getActive();
    const dt = Math.min(delta, 0.05);

    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      p.life -= dt;
      if (p.life <= 0) {
        pool.release(p);
        continue;
      }

      p.velocity.y -= 6 * dt;
      p.position.addScaledVector(p.velocity, dt);
    }

    const updated = pool.getActive();
    for (let i = 0; i < MAX_INSTANCES; i++) {
      const p = updated[i];
      if (p) {
        const t = p.life / p.maxLife;
        dummy.current.position.copy(p.position);
        dummy.current.scale.setScalar(p.scale * t);
        dummy.current.updateMatrix();
        mesh.setMatrixAt(i, dummy.current.matrix);
      } else {
        dummy.current.position.copy(hidden);
        dummy.current.scale.setScalar(0);
        dummy.current.updateMatrix();
        mesh.setMatrixAt(i, dummy.current.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  const geometry = useMemo(() => new THREE.BoxGeometry(0.12, 0.12, 0.12), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#9a7a5a',
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    [],
  );

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_INSTANCES]}
      frustumCulled={false}
    />
  );
}
