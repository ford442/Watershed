/**
 * PillarFragmentPool — global dynamic debris for shattered columns.
 *
 * Fragments are InstancedRigidBodies with convex-hull colliders, capped at
 * MAX_LIVE_PILLAR_FRAGMENTS, and excluded from shadow casting at high LOD.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { InstancedRigidBodies, type RapierRigidBody } from '@react-three/rapier';
import {
  clearPillarFragmentRegistry,
  releasePillarFragmentSlots,
} from '../../systems/PillarFragmentRegistry';
import {
  PILLAR_FRAGMENT_LIFETIME_S,
  type PillarFragmentSpawn,
} from './pillarCrumble';

export interface ActivePillarFragment {
  id: number;
  spawn: PillarFragmentSpawn;
  bornAt: number;
}

let nextFragmentId = 0;

/** Module-level queue so Rock columns can enqueue debris without React context. */
const pendingSpawns: ActivePillarFragment[] = [];

export function enqueuePillarFragments(spawns: PillarFragmentSpawn[]): void {
  const now = performance.now() / 1000;
  for (const spawn of spawns) {
    pendingSpawns.push({ id: nextFragmentId++, spawn, bornAt: now });
  }
}

interface PillarFragmentPoolProps {
  castShadow?: boolean;
}

export default function PillarFragmentPool({ castShadow = false }: PillarFragmentPoolProps) {
  const [fragments, setFragments] = useState<ActivePillarFragment[]>([]);
  const bodiesRef = useRef<RapierRigidBody[] | null>(null);
  const impulseAppliedRef = useRef<Set<number>>(new Set());

  const geometry = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pos = geo.getAttribute('position');
    const vertex = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      vertex.fromBufferAttribute(pos, i);
      vertex.multiplyScalar(0.85 + (Math.sin(i * 2.1) * 0.5 + 0.5) * 0.3);
      pos.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#8b6f52',
        roughness: 0.92,
        metalness: 0.05,
      }),
    [],
  );

  const flushPending = useCallback(() => {
    if (pendingSpawns.length === 0) return;
    const batch = pendingSpawns.splice(0, pendingSpawns.length);
    setFragments((prev) => [...prev, ...batch]);
  }, []);

  useEffect(() => {
    const onReset = () => {
      pendingSpawns.length = 0;
      impulseAppliedRef.current.clear();
      setFragments((prev) => {
        if (prev.length > 0) releasePillarFragmentSlots(prev.length);
        return [];
      });
      clearPillarFragmentRegistry();
    };

    window.addEventListener('watershed-run-reset', onReset);
    return () => window.removeEventListener('watershed-run-reset', onReset);
  }, []);

  useFrame(() => {
    flushPending();

    const now = performance.now() / 1000;
    setFragments((prev) => {
      const survivors = prev.filter((f) => now - f.bornAt < PILLAR_FRAGMENT_LIFETIME_S);
      const removed = prev.length - survivors.length;
      if (removed > 0) {
        releasePillarFragmentSlots(removed);
      }
      return survivors.length === prev.length ? prev : survivors;
    });
  });

  useEffect(() => {
    const bodies = bodiesRef.current;
    if (!bodies) return;

    fragments.forEach((frag, index) => {
      if (impulseAppliedRef.current.has(frag.id)) return;
      const body = bodies[index];
      if (!body) return;

      const { impulse } = frag.spawn;
      body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
      impulseAppliedRef.current.add(frag.id);
    });
  }, [fragments]);

  const instances = useMemo(
    () =>
      fragments.map((frag) => ({
        key: `pillar-frag-${frag.id}`,
        position: [
          frag.spawn.position.x,
          frag.spawn.position.y,
          frag.spawn.position.z,
        ] as [number, number, number],
        rotation: [
          frag.spawn.rotation.x,
          frag.spawn.rotation.y,
          frag.spawn.rotation.z,
        ] as [number, number, number],
        scale: [
          frag.spawn.scale.x,
          frag.spawn.scale.y,
          frag.spawn.scale.z,
        ] as [number, number, number],
        type: 'dynamic' as const,
        mass: 2.5,
        friction: 0.85,
        restitution: 0.12,
        linearDamping: 0.35,
        angularDamping: 0.6,
      })),
    [fragments],
  );

  if (instances.length === 0) return null;

  return (
    <InstancedRigidBodies
      ref={bodiesRef}
      instances={instances}
      colliders="hull"
    >
      <instancedMesh
        args={[geometry, material, instances.length]}
        castShadow={castShadow}
        receiveShadow
      />
    </InstancedRigidBodies>
  );
}
