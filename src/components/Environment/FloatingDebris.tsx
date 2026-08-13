import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { InstancedRigidBodies, type RapierRigidBody } from '@react-three/rapier';
import { useDriftwoodAssets, usePineconeAssets } from './DebrisAssets';
import type { FloatingDebrisProps } from './types';

type DebrisKind = 'driftwood' | 'pinecone';

interface DebrisSimItem {
  key: number;
  debrisType: DebrisKind;
  t: number;
  lateralOffset: number;
  rotationSpeed: THREE.Vector3;
  scale: [number, number, number];
}

interface RigidBodyInstanceProps {
  key: number;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export default function FloatingDebris({
  path,
  waterLevel = 0.5,
  count = 12,
  seed = 0,
}: FloatingDebrisProps) {
  const driftwood = useDriftwoodAssets();
  const pinecone = usePineconeAssets();

  const pathLength = useMemo(() => (path ? path.getLength() : 1), [path]);

  const debris = useMemo((): DebrisSimItem[] => {
    if (!path) return [];

    const items: DebrisSimItem[] = [];
    const seededRandom = (s: number): number => {
      const x = Math.sin(s) * 10000;
      return x - Math.floor(x);
    };
    let currentSeed = seed;

    for (let i = 0; i < count; i++) {
      const debrisType: DebrisKind = seededRandom(currentSeed++) > 0.7 ? 'driftwood' : 'pinecone';
      const t = seededRandom(currentSeed++);
      const lateralOffset = (seededRandom(currentSeed++) - 0.5) * 5.0;
      const rotationSpeed = new THREE.Vector3(
        seededRandom(currentSeed++),
        seededRandom(currentSeed++),
        seededRandom(currentSeed++),
      ).subScalar(0.5).multiplyScalar(2.0);

      let scale: [number, number, number];
      if (debrisType === 'driftwood') {
        const s = 0.5 + seededRandom(currentSeed++) * 0.5;
        scale = [s, s, s];
      } else {
        const s = 0.4 + seededRandom(currentSeed++) * 0.3;
        scale = [s, s, s];
      }

      items.push({
        key: i,
        debrisType,
        t,
        lateralOffset,
        rotationSpeed,
        scale,
      });
    }
    return items;
  }, [path, count, seed]);

  const driftwoodInstances = useMemo(
    () => debris.filter((d) => d.debrisType === 'driftwood'),
    [debris],
  );
  const pineconeInstances = useMemo(
    () => debris.filter((d) => d.debrisType === 'pinecone'),
    [debris],
  );

  const driftwoodRef = useRef<(RapierRigidBody | null)[]>([]);
  const pineconeRef = useRef<(RapierRigidBody | null)[]>([]);

  const toRigidInstances = (items: DebrisSimItem[]): RigidBodyInstanceProps[] =>
    items.map((item) => ({
      key: item.key,
      position: [0, -50, 0],
      rotation: [0, 0, 0],
      scale: item.scale,
    }));

  useFrame((state, delta) => {
    if (!path) return;

    const updateInstances = (instances: DebrisSimItem[], ref: React.MutableRefObject<(RapierRigidBody | null)[]>) => {
      if (!ref.current || ref.current.length === 0) return;

      const tSpeed = (2.5 * delta) / pathLength;
      const dummyObj = new THREE.Object3D();
      const normal = new THREE.Vector3(0, 1, 0);

      instances.forEach((item, i) => {
        item.t += tSpeed;
        if (item.t > 1.0) item.t -= 1.0;

        const point = path.getPointAt(item.t);
        const tangent = path.getTangentAt(item.t).normalize();
        const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

        point.add(binormal.multiplyScalar(item.lateralOffset));
        point.y = waterLevel - 0.1 + Math.sin(state.clock.elapsedTime * 2.0 + item.key) * 0.05;

        dummyObj.position.copy(point);
        dummyObj.lookAt(point.clone().add(tangent));

        if (item.debrisType === 'driftwood') {
          dummyObj.rotateZ(state.clock.elapsedTime * item.rotationSpeed.z);
        } else {
          dummyObj.rotateX(state.clock.elapsedTime * item.rotationSpeed.x);
          dummyObj.rotateY(state.clock.elapsedTime * item.rotationSpeed.y);
        }

        const rb = ref.current[i];
        if (rb) {
          rb.setNextKinematicTranslation(point);
          rb.setNextKinematicRotation(dummyObj.quaternion);
        }
      });
    };

    updateInstances(driftwoodInstances, driftwoodRef);
    updateInstances(pineconeInstances, pineconeRef);
  });

  if (!path) return null;

  return (
    <group>
      {driftwoodInstances.length > 0 && (
        <InstancedRigidBodies
          ref={driftwoodRef}
          instances={toRigidInstances(driftwoodInstances)}
          colliders="hull"
          type="kinematicPosition"
        >
          <instancedMesh
            args={[driftwood.geometry, driftwood.material, driftwoodInstances.length]}
            receiveShadow
            castShadow
          />
        </InstancedRigidBodies>
      )}

      {pineconeInstances.length > 0 && (
        <InstancedRigidBodies
          ref={pineconeRef}
          instances={toRigidInstances(pineconeInstances)}
          colliders="hull"
          type="kinematicPosition"
        >
          <instancedMesh
            args={[pinecone.geometry, pinecone.material, pineconeInstances.length]}
            receiveShadow
            castShadow
          />
        </InstancedRigidBodies>
      )}
    </group>
  );
}
