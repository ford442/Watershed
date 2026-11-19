import React, { useCallback, useEffect, useMemo } from 'react';
import { RigidBody, CuboidCollider, TrimeshCollider } from '@react-three/rapier';
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

  // The floor's triangles, as `colliders="trimesh"` would build them (one copy;
  // the worker gets its own below, since its buffers are transferred away).
  const floor = useMemo(() => trimeshSpecFromGeometry(collisionGeometry), [collisionGeometry]);

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
        <RigidBody key={`rb-collision-${segmentId}`} type="fixed" colliders={false}>
          {/*
           * A new hull (an eroded floor, #487 E) is a new trimesh. It is an
           * explicit collider keyed on the geometry, in a body that stays: the
           * old floor's removal and the new one's creation land in the same
           * commit. With `colliders="trimesh"` the body remounted and its auto
           * collider was only built a render later, so for a commit the segment
           * had no floor — up to a whole stepScripted batch, a frame or two in
           * real time — and a body standing on it fell through when the
           * floor came back above it (#578 A: a dam release's surge erodes the
           * basin under the player).
           */}
          <TrimeshCollider
            key={collisionGeometry.uuid}
            args={[floor.vertices, floor.indices]}
            friction={friction}
            restitution={restitution}
          />
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
