import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ParticlePool, writeParticleInstances } from './particlePool';
import { emitCollisionBurst, COLLISION_PARTICLE_CAPACITY } from './CollisionParticles';
import { SurfaceMaterial } from '../systems/vehicle/VehicleSystem';

const spawnAt = (pool: ParticlePool, x: number, life = 1) =>
  pool.spawn({ x, y: 0, z: 0, vx: 1, vy: 0, vz: 0, life, size: 0.1 });

describe('ParticlePool', () => {
  it('integrates velocity and gravity, and drops the dead', () => {
    const pool = new ParticlePool(8);
    pool.spawn({ x: 0, y: 10, z: 0, vx: 2, vy: 0, vz: 0, life: 1, size: 0.1, gravity: -10 });
    spawnAt(pool, 5, 0.25);
    pool.step(0.5);
    expect(pool.count).toBe(1);
    expect(pool.position[0]).toBeCloseTo(1, 6);
    expect(pool.velocity[1]).toBeCloseTo(-5, 6);
    expect(pool.position[1]).toBeCloseTo(7.5, 6);
    pool.step(0.6);
    expect(pool.count).toBe(0);
  });

  it('never grows past capacity: a full pool overwrites in rotation', () => {
    const pool = new ParticlePool(4);
    for (let i = 0; i < 10; i += 1) spawnAt(pool, i);
    expect(pool.count).toBe(4);
    const xs = Array.from({ length: 4 }, (_, i) => pool.position[i * 3]).sort((a, b) => a - b);
    // The newest spawns survive.
    expect(xs).toEqual([6, 7, 8, 9]);
  });

  it('ignores non-positive lifetimes and dt', () => {
    const pool = new ParticlePool(2);
    spawnAt(pool, 0, 0);
    expect(pool.count).toBe(0);
    spawnAt(pool, 0, 1);
    pool.step(0);
    pool.step(Number.NaN);
    expect(pool.position[0]).toBe(0);
  });

  it('writes live particles into an InstancedMesh and sets its count', () => {
    const pool = new ParticlePool(4);
    pool.spawn({ x: 1, y: 2, z: 3, vx: 0, vy: 0, vz: 0, life: 2, size: 0.5, r: 1, g: 0, b: 0 });
    pool.step(1); // half life left → half radius
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1), new THREE.MeshBasicMaterial(), 4);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(12), 3);
    writeParticleInstances(pool, mesh);
    expect(mesh.count).toBe(1);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);
    expect(p.toArray()).toEqual([1, 2, 3]);
    expect(s.x).toBeCloseTo(0.25, 6);
    const c = new THREE.Color();
    mesh.getColorAt(0, c);
    expect([c.r, c.g, c.b]).toEqual([1, 0, 0]);
  });
});

describe('emitCollisionBurst', () => {
  it('spawns 10–30 particles by intensity, within the vehicle pool', () => {
    const soft = new ParticlePool(COLLISION_PARTICLE_CAPACITY);
    emitCollisionBurst(soft, SurfaceMaterial.MOSS, { x: 0, y: 0, z: 0 }, 0);
    expect(soft.count).toBe(10);
    const hard = new ParticlePool(COLLISION_PARTICLE_CAPACITY);
    emitCollisionBurst(hard, SurfaceMaterial.ROCK, { x: 0, y: 0, z: 0 }, 1);
    expect(hard.count).toBe(30);
    for (let i = 0; i < hard.count; i += 1) {
      expect(hard.gravity[i]).toBeCloseTo(-9.8, 5);
      expect(hard.velocity[i * 3 + 1]).toBeGreaterThan(0); // upward bias
    }
  });
});
