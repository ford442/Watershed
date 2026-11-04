/**
 * Rock instancing (#487 D Phase C): the instance matrix and the Rapier body
 * read one quaternion, the bounding sphere follows the written matrices, and a
 * recycled slot with fewer rocks keeps no stale instance.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { instanceQuaternion, writeRockInstances, type RockTransform } from './Rock';

function rocks(n: number, z0: number): RockTransform[] {
  return Array.from({ length: n }, (_, i) => ({
    position: new THREE.Vector3(i * 3 - 40, -120 - i * 0.5, z0 - i * 2),
    rotation: new THREE.Euler(i * 0.3, i * 0.7, i * 0.11),
    scale: new THREE.Vector3(1 + i * 0.01, 1, 1),
    color: '#8f8576',
  })).map((r) => ({ ...r, quaternion: instanceQuaternion(r.rotation) }));
}

const geometry = new THREE.IcosahedronGeometry(1, 1);
const material = new THREE.MeshBasicMaterial();

describe('writeRockInstances', () => {
  it('composes each matrix from the quaternion Rapier is given', () => {
    const list = rocks(5, -300);
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    writeRockInstances(mesh, list);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    list.forEach((rock, i) => {
      mesh.getMatrixAt(i, m);
      m.decompose(p, q, s);
      const expected = new THREE.Quaternion().setFromEuler(rock.rotation);
      expect(Math.abs(q.dot(expected))).toBeCloseTo(1, 6);
      expect([q.x, q.y, q.z, q.w].map((v) => Math.abs(v))).toEqual(
        rock.quaternion!.map((v) => expect.closeTo(Math.abs(v), 6)),
      );
      expect(p.distanceTo(rock.position)).toBeLessThan(1e-4);
    });
  });

  it('recomputes the bounding sphere after the writes (no stale origin sphere)', () => {
    const list = rocks(12, -500);
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    // A culling test before the writes caches a sphere around the origin.
    mesh.computeBoundingSphere();
    expect(mesh.boundingSphere!.center.length()).toBeLessThan(1);
    writeRockInstances(mesh, list);
    for (const rock of list) {
      expect(mesh.boundingSphere!.containsPoint(rock.position)).toBe(true);
    }
    expect(mesh.boundingSphere!.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(false);
  });

  it('a slot recycled from 40 rocks to 10 keeps none of the 40', () => {
    const dense = rocks(40, -200);
    const sparse = rocks(10, -900);
    const mesh = new THREE.InstancedMesh(geometry, material, dense.length);
    writeRockInstances(mesh, dense);
    expect(mesh.count).toBe(40);
    writeRockInstances(mesh, sparse);
    expect(mesh.count).toBe(10);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.distanceTo(sparse[i].position)).toBeLessThan(1e-4);
    }
    // The sphere bounds only what is drawn: nothing left near the dense slot's rocks.
    expect(mesh.boundingSphere!.containsPoint(dense[39].position)).toBe(false);
  });
});
