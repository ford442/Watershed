/**
 * three.js → StaticColliderSpec, for streaming the level to the raft's Rapier
 * worker (#465 C2). Every call returns fresh buffers (the proxy transfers them).
 */
import * as THREE from 'three';
import type {
  QuatTuple,
  StaticBoxColliderSpec,
  StaticColliderMaterial,
  StaticHullColliderSpec,
  StaticTrimeshColliderSpec,
  Vec3Tuple,
} from './rapierWorkerProtocol';

type Vec3Like = { x: number; y: number; z: number };
type EulerLike = { x: number; y: number; z: number };

const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();

export function quatTupleFromEuler(rotation: EulerLike | undefined): QuatTuple | undefined {
  if (!rotation || (rotation.x === 0 && rotation.y === 0 && rotation.z === 0)) return undefined;
  tmpQuat.setFromEuler(tmpEuler.set(rotation.x, rotation.y, rotation.z));
  return [tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w];
}

const tuple = (v: Vec3Like): Vec3Tuple => [v.x, v.y, v.z];

/** Same triangles @react-three/rapier's `colliders="trimesh"` builds (geometry is world-space). */
export function trimeshSpecFromGeometry(
  geometry: THREE.BufferGeometry,
  material: StaticColliderMaterial = {},
): StaticTrimeshColliderSpec {
  const position = geometry.getAttribute('position');
  const vertices = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    vertices[i * 3] = position.getX(i);
    vertices[i * 3 + 1] = position.getY(i);
    vertices[i * 3 + 2] = position.getZ(i);
  }
  const index = geometry.getIndex();
  const indices = index
    ? Uint32Array.from(index.array as ArrayLike<number>)
    : Uint32Array.from({ length: position.count }, (_, i) => i);
  return { kind: 'trimesh', vertices, indices, ...material };
}

/** Convex hull of `geometry` scaled by the mesh scale, posed by the body transform. */
export function hullSpecFromGeometry(
  geometry: THREE.BufferGeometry,
  pose: { position: Vec3Like; rotation?: EulerLike; scale?: Vec3Like },
  material: StaticColliderMaterial = {},
): StaticHullColliderSpec {
  const position = geometry.getAttribute('position');
  const sx = pose.scale?.x ?? 1;
  const sy = pose.scale?.y ?? 1;
  const sz = pose.scale?.z ?? 1;
  const points = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    points[i * 3] = position.getX(i) * sx;
    points[i * 3 + 1] = position.getY(i) * sy;
    points[i * 3 + 2] = position.getZ(i) * sz;
  }
  return {
    kind: 'hull',
    points,
    position: tuple(pose.position),
    rotation: quatTupleFromEuler(pose.rotation),
    ...material,
  };
}

export function boxSpec(
  halfExtents: Vec3Tuple,
  position: Vec3Like,
  rotation?: EulerLike,
  material: StaticColliderMaterial = {},
): StaticBoxColliderSpec {
  return { halfExtents, position: tuple(position), rotation: quatTupleFromEuler(rotation), ...material };
}
