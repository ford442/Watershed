import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRaftHullPrimitive, RAFT_HULL_COLLIDERS } from './raftHull';

describe('raft hull', () => {
  it('declares the colliders the auto-collider pass derived from the primitive hull', () => {
    // @react-three/rapier `colliders="cuboid"`: one cuboid per child mesh, half its
    // bounding box, at the mesh position plus the box centre — in child order.
    const { object, dispose } = buildRaftHullPrimitive();
    const derived: { halfExtents: number[]; position: number[] }[] = [];
    object.traverseVisible((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3()).add(mesh.position);
      derived.push({ halfExtents: [size.x / 2, size.y / 2, size.z / 2], position: centre.toArray() });
    });
    // Rapier is f32: the box geometry's Float32 positions and these literals are the same shape.
    const f32 = (v: readonly number[]) => v.map(Math.fround);
    expect(RAFT_HULL_COLLIDERS.map((c) => ({ halfExtents: f32(c.halfExtents), position: f32(c.position) }))).toEqual(
      derived.map((c) => ({ halfExtents: f32(c.halfExtents), position: f32(c.position) })),
    );
    dispose();
  });

  it('keeps the 2 × 0.3 × 3 m hull box the worker body and the water forces use', () => {
    expect(RAFT_HULL_COLLIDERS[0]).toEqual({ halfExtents: [1, 0.15, 1.5], position: [0, 0, 0] });
  });

  it('tints the hull box, not the deck, and reports its dry colour', () => {
    const instance = buildRaftHullPrimitive();
    expect(instance.source).toBe('primitive');
    expect(instance.tintMaterial?.color.getHex()).toBe(new THREE.Color('saddlebrown').getHex());
    expect(instance.dryColor.equals(instance.tintMaterial!.color)).toBe(true);
    instance.dispose();
  });
});
