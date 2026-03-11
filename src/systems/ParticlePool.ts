/**
 * ParticlePool - Generic object pooling system for particles
 * 
 * Implements efficient memory management for particle systems to
 * eliminate GC spikes during high particle density.
 */

import * as THREE from 'three';

export interface PoolableParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  scale: number;
  active: boolean;
  reset(): void;
}

/**
 * Generic particle pool for efficient memory management
 */
export class ParticlePool<T extends PoolableParticle> {
  private pool: T[] = [];
  private active: T[] = [];
  private factory: () => T;
  private maxSize: number;

  constructor(factory: () => T, initialSize = 500, maxSize = 2000) {
    this.factory = factory;
    this.maxSize = maxSize;
    
    // Pre-initialize pool
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
    }
  }

  /**
   * Acquire a particle from the pool
   */
  acquire(): T {
    // Try to get from pool
    if (this.pool.length > 0) {
      const particle = this.pool.pop()!;
      particle.active = true;
      this.active.push(particle);
      return particle;
    }
    
    // Pool empty - create new if under max
    if (this.active.length < this.maxSize) {
      const particle = this.factory();
      particle.active = true;
      this.active.push(particle);
      return particle;
    }
    
    // Max reached - recycle oldest active
    const oldest = this.active.shift()!;
    oldest.reset();
    oldest.active = true;
    this.active.push(oldest);
    return oldest;
  }

  /**
   * Acquire multiple particles
   */
  acquireMultiple(count: number): T[] {
    const particles: T[] = [];
    for (let i = 0; i < count; i++) {
      particles.push(this.acquire());
    }
    return particles;
  }

  /**
   * Release a particle back to the pool
   */
  release(particle: T): void {
    const index = this.active.indexOf(particle);
    if (index !== -1) {
      this.active.splice(index, 1);
    }
    
    if (this.pool.length < this.maxSize) {
      particle.reset();
      particle.active = false;
      this.pool.push(particle);
    }
  }

  /**
   * Get all active particles
   */
  getActive(): readonly T[] {
    return this.active;
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      available: this.pool.length,
      active: this.active.length,
      total: this.pool.length + this.active.length,
      utilization: this.active.length / (this.pool.length + this.active.length),
    };
  }

  /**
   * Clear all active particles
   */
  clear(): void {
    for (const particle of this.active) {
      particle.reset();
      particle.active = false;
      this.pool.push(particle);
    }
    this.active.length = 0;
  }
}

/**
 * Simple particle implementation for VFX
 */
export class VFXParticle implements PoolableParticle {
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  life = 0;
  maxLife = 1;
  scale = 1;
  active = false;
  color = new THREE.Color(1, 1, 1);
  rotation = 0;
  rotationSpeed = 0;
  
  reset(): void {
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.life = 0;
    this.maxLife = 1;
    this.scale = 1;
    this.color.set(1, 1, 1);
    this.rotation = 0;
    this.rotationSpeed = 0;
  }

  update(delta: number, gravity = -9.8): boolean {
    if (!this.active) return false;
    
    // Update position
    this.position.x += this.velocity.x * delta;
    this.position.y += this.velocity.y * delta;
    this.position.z += this.velocity.z * delta;
    
    // Apply gravity
    this.velocity.y += gravity * delta;
    
    // Apply damping
    this.velocity.multiplyScalar(0.98);
    
    // Update rotation
    this.rotation += this.rotationSpeed * delta;
    
    // Update life
    this.life += delta;
    
    // Check if dead
    if (this.life >= this.maxLife) {
      this.active = false;
      return false;
    }
    
    return true;
  }

  getLifeRatio(): number {
    return 1 - (this.life / this.maxLife);
  }
}

/**
 * Foam particle for water surface
 */
export class FoamParticle extends VFXParticle {
  driftSpeed = 1.0;
  
  reset(): void {
    super.reset();
    this.driftSpeed = 1.0;
  }

  update(delta: number, flowDirection: THREE.Vector3, flowSpeed: number): boolean {
    if (!this.active) return false;
    
    // Follow water flow
    this.position.x += flowDirection.x * flowSpeed * this.driftSpeed * delta;
    this.position.z += flowDirection.z * flowSpeed * this.driftSpeed * delta;
    
    // Slight bobbing
    this.position.y += Math.sin(this.life * 3) * 0.02;
    
    this.life += delta;
    
    if (this.life >= this.maxLife) {
      this.active = false;
      return false;
    }
    
    return true;
  }
}

/**
 * Global particle manager singleton
 */
class ParticleManager {
  private pools = new Map<string, ParticlePool<VFXParticle>>();

  createPool(name: string, factory: () => VFXParticle, initialSize = 500) {
    const pool = new ParticlePool(factory, initialSize);
    this.pools.set(name, pool);
    return pool;
  }

  getPool(name: string): ParticlePool<VFXParticle> | undefined {
    return this.pools.get(name);
  }

  getAllStats() {
    const stats: Record<string, ReturnType<ParticlePool<VFXParticle>['getStats']>> = {};
    this.pools.forEach((pool, name) => {
      stats[name] = pool.getStats();
    });
    return stats;
  }

  clearAll() {
    this.pools.forEach(pool => pool.clear());
  }
}

export const particleManager = new ParticleManager();

export default ParticlePool;
