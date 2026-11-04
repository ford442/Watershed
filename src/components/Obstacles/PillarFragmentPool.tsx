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
} from '../../systems/pools/PillarFragmentRegistry';
import {
  PILLAR_FRAGMENT_LIFETIME_S,
  type PillarFragmentSpawn,
} from './pillarCrumble';
import { NonEmptyInstancedMesh } from '../../rendering/instancing/NonEmptyInstancedMesh';
import { gameEvents } from '../../systems/events/GameEvents';
import { getPillarFragmentClock } from './pillarSimClock';

export interface ActivePillarFragment {
  id: number;
  spawn: PillarFragmentSpawn;
  /** Pillar-fragment sim clock (seconds) at enqueue. */
  bornAt: number;
}

let nextFragmentId = 0;

/** Module-level queue so Rock columns can enqueue debris without React context. */
const pendingSpawns: ActivePillarFragment[] = [];

export function enqueuePillarFragments(spawns: PillarFragmentSpawn[]): void {
  for (const spawn of spawns) {
    pendingSpawns.push({ id: nextFragmentId++, spawn, bornAt: getPillarFragmentClock() });
  }
}

/**
 * Split `live` into survivors at the pool's sim clock (advanced by SimCore's
 * `pillars` system, pillarSimClock.ts). Returns null when nothing expired (the
 * caller keeps its array as is).
 */
export function expirePillarFragments(
  live: readonly ActivePillarFragment[],
): ActivePillarFragment[] | null {
  const now = getPillarFragmentClock();
  if (!live.some((f) => now - f.bornAt >= PILLAR_FRAGMENT_LIFETIME_S)) return null;
  return live.filter((f) => now - f.bornAt < PILLAR_FRAGMENT_LIFETIME_S);
}

interface PillarFragmentPoolProps {
  castShadow?: boolean;
}

export default function PillarFragmentPool({ castShadow = false }: PillarFragmentPoolProps) {
  const [fragments, setFragments] = useState<ActivePillarFragment[]>([]);
  // The live list as of the last commit plus this frame's changes: read every
  // frame without a state update, so a quiet frame costs no React work.
  const liveRef = useRef<ActivePillarFragment[]>([]);
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

  const commit = useCallback((next: ActivePillarFragment[]) => {
    liveRef.current = next;
    setFragments(next);
  }, []);

  useEffect(() => {
    const onReset = () => {
      pendingSpawns.length = 0;
      impulseAppliedRef.current.clear();
      if (liveRef.current.length > 0) releasePillarFragmentSlots(liveRef.current.length);
      commit([]);
      clearPillarFragmentRegistry();
    };

    return gameEvents.on('watershed-run-reset', onReset);
  }, [commit]);

  useFrame(() => {
    let next: ActivePillarFragment[] | null = null;
    if (pendingSpawns.length > 0) {
      next = [...liveRef.current, ...pendingSpawns.splice(0, pendingSpawns.length)];
    }
    const base = next ?? liveRef.current;
    const survivors = expirePillarFragments(base);
    if (survivors) {
      releasePillarFragmentSlots(base.length - survivors.length);
      next = survivors;
    }
    if (next) commit(next);
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
      <NonEmptyInstancedMesh
        args={[geometry, material, instances.length]}
        castShadow={castShadow}
        receiveShadow
      />
    </InstancedRigidBodies>
  );
}
