/**
 * particlePool.ts — fixed-capacity ballistic particles in typed arrays (#503 B).
 *
 * The vehicles' foam, shed and collision particles used to be arrays of
 * `{ position: Vector3, … }` rebuilt with `map`/`clone` every frame and drawn
 * as one React `<mesh>` each — from a ref, so nothing re-rendered when they
 * changed and a burst only appeared when something else happened to render
 * the vehicle. A pool is spawned into from physics code and stepped/drawn by
 * one `InstancedMesh` (`ParticlePoolMesh`); neither side allocates per frame.
 *
 * Full pool: a spawn overwrites live slots in rotation (a ring cursor), so a
 * burst storm degrades to "newest wins" instead of growing without bound.
 */
import * as THREE from 'three';

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds to live. */
  life: number;
  /** Radius at full life (the drawn radius shrinks with remaining life). */
  size: number;
  /** Vertical acceleration (m/s², negative = down). */
  gravity?: number;
  /** Linear 0–1 RGB; white when omitted. */
  r?: number;
  g?: number;
  b?: number;
}

export class ParticlePool {
  readonly capacity: number;
  /** Live particles occupy slots [0, count). */
  count = 0;
  readonly position: Float32Array;
  readonly velocity: Float32Array;
  readonly color: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly gravity: Float32Array;
  private ring = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.position = new Float32Array(this.capacity * 3);
    this.velocity = new Float32Array(this.capacity * 3);
    this.color = new Float32Array(this.capacity * 3);
    this.life = new Float32Array(this.capacity);
    this.maxLife = new Float32Array(this.capacity);
    this.size = new Float32Array(this.capacity);
    this.gravity = new Float32Array(this.capacity);
  }

  spawn(p: ParticleSpawn): void {
    if (!(p.life > 0)) return;
    let i: number;
    if (this.count < this.capacity) {
      i = this.count;
      this.count += 1;
    } else {
      i = this.ring;
      this.ring = (this.ring + 1) % this.capacity;
    }
    const o = i * 3;
    this.position[o] = p.x;
    this.position[o + 1] = p.y;
    this.position[o + 2] = p.z;
    this.velocity[o] = p.vx;
    this.velocity[o + 1] = p.vy;
    this.velocity[o + 2] = p.vz;
    this.color[o] = p.r ?? 1;
    this.color[o + 1] = p.g ?? 1;
    this.color[o + 2] = p.b ?? 1;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.size[i] = p.size;
    this.gravity[i] = p.gravity ?? 0;
  }

  /** Integrate and drop the dead (swap-remove: order is not preserved). */
  step(dt: number): void {
    if (!(dt > 0)) return;
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.moveSlot(this.count - 1, i);
        this.count -= 1;
        continue;
      }
      const o = i * 3;
      this.velocity[o + 1] += this.gravity[i] * dt;
      this.position[o] += this.velocity[o] * dt;
      this.position[o + 1] += this.velocity[o + 1] * dt;
      this.position[o + 2] += this.velocity[o + 2] * dt;
      i += 1;
    }
    if (this.ring >= this.count) this.ring = 0;
  }

  clear(): void {
    this.count = 0;
    this.ring = 0;
  }

  private moveSlot(from: number, to: number): void {
    if (from === to) return;
    const f = from * 3;
    const t = to * 3;
    for (let k = 0; k < 3; k += 1) {
      this.position[t + k] = this.position[f + k];
      this.velocity[t + k] = this.velocity[f + k];
      this.color[t + k] = this.color[f + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size[to] = this.size[from];
    this.gravity[to] = this.gravity[from];
  }
}

const _matrix = new THREE.Matrix4();
const _color = new THREE.Color();

/**
 * Write the live particles into `mesh` (a unit-radius instanced geometry):
 * translation, uniform scale `size × life/maxLife`, instance colour.
 * Sets `mesh.count`; never allocates.
 */
export function writeParticleInstances(pool: ParticlePool, mesh: THREE.InstancedMesh): void {
  const n = Math.min(pool.count, mesh.instanceMatrix.count);
  for (let i = 0; i < n; i += 1) {
    const o = i * 3;
    const s = pool.size[i] * (pool.life[i] / pool.maxLife[i]);
    _matrix.makeScale(s, s, s);
    _matrix.setPosition(pool.position[o], pool.position[o + 1], pool.position[o + 2]);
    mesh.setMatrixAt(i, _matrix);
    if (mesh.instanceColor) {
      _color.setRGB(pool.color[o], pool.color[o + 1], pool.color[o + 2]);
      mesh.setColorAt(i, _color);
    }
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
