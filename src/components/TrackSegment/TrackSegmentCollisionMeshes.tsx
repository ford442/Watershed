import React, { useCallback, useEffect } from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import type { BufferGeometry } from 'three';
import {
  resolveSegmentFriction,
  resolveSegmentRestitution,
} from '../../systems/survival/surfaceFriction';
import type { TrackBiomeProfile } from '../../configs/TrackBiomes';
import {
  registerCollisionTriangles,
  unregisterCollisionTriangles,
} from '../../debug/physicsColliderRegistry';
import { useWorkerStaticCollider } from '../../physics/workerColliderRegistry';
import { trimeshSpecFromGeometry } from '../../physics/colliderSpecsFromThree';

export type TrackSegmentCollisionMeshesProps = {
  segmentId: number;
  openFloor: boolean;
  collisionGeometry: BufferGeometry;
  biomeProfile: TrackBiomeProfile;
  slipperiness: number;
  segmentState?: string;
  type: string;
  segmentCenter: { x: number; y: number; z: number };
};

/** Rapier collision mount for a track segment (visual mesh is separate). */
export function TrackSegmentCollisionMeshes({
  segmentId,
  openFloor,
  collisionGeometry,
  biomeProfile,
  slipperiness,
  segmentState,
  type,
  segmentCenter,
}: TrackSegmentCollisionMeshesProps) {
  useEffect(() => {
    if (openFloor) return undefined;
    const index = collisionGeometry.index;
    const triangleCount = index
      ? index.count / 3
      : collisionGeometry.attributes.position.count / 3;
    registerCollisionTriangles(segmentId, triangleCount);
    return () => unregisterCollisionTriangles(segmentId);
  }, [segmentId, openFloor, collisionGeometry]);

  const friction = resolveSegmentFriction({
    baseFriction: biomeProfile.wallFriction,
    slipperiness,
    segmentState,
  });
  const restitution = resolveSegmentRestitution(
    biomeProfile.id === 'slotCanyon' ? 0.02 : 0.1,
    slipperiness,
  );

  // The same canyon, mirrored into the raft's Rapier worker (#465 C2).
  const buildWorkerTrimesh = useCallback(
    () => trimeshSpecFromGeometry(collisionGeometry, { friction, restitution }),
    [collisionGeometry, friction, restitution],
  );
  useWorkerStaticCollider(`seg:${segmentId}`, openFloor ? null : buildWorkerTrimesh);

  // The splash/pond safety box below sits at an absolute y = -8; it is not
  // mirrored — the worker world carries no absolute-Y floors (the trimesh
  // already has the pool bed).
  const hasPoolFloor = type === 'splash' || type === 'pond';

  return (
    <>
      {!openFloor && (
        <RigidBody
          key={`rb-collision-${segmentId}`}
          type="fixed"
          colliders="trimesh"
          friction={friction}
          restitution={restitution}
        >
          <mesh geometry={collisionGeometry} visible={false} />
        </RigidBody>
      )}

      {hasPoolFloor && (
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider
            args={[60, 0.5, 60]}
            position={[segmentCenter.x, -8, segmentCenter.z]}
            friction={0.9}
            restitution={0.1}
          />
        </RigidBody>
      )}
    </>
  );
}
