import React from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import type { BufferGeometry } from 'three';
import {
  resolveSegmentFriction,
  resolveSegmentRestitution,
} from '../../systems/survival/surfaceFriction';
import type { TrackBiomeProfile } from '../../configs/TrackBiomes';

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
  return (
    <>
      {!openFloor && (
        <RigidBody
          key={`rb-collision-${segmentId}`}
          type="fixed"
          colliders="trimesh"
          friction={resolveSegmentFriction({
            baseFriction: biomeProfile.wallFriction,
            slipperiness,
            segmentState,
          })}
          restitution={resolveSegmentRestitution(
            biomeProfile.id === 'slotCanyon' ? 0.02 : 0.1,
            slipperiness,
          )}
        >
          <mesh geometry={collisionGeometry} visible={false} />
        </RigidBody>
      )}

      {(type === 'splash' || type === 'pond') && (
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
