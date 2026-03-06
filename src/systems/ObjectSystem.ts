/**
 * ObjectSystem.ts - Spawnable objects and object pooling
 * 
 * RESPONSIBILITIES:
 * - Generic object pool for frequently spawned objects
 * - Base class for all spawnable game objects
 * - Collision handling interface
 * - Performance tracking
 * 
 * SWARM: Extend SpawnableObject for new object types
 */

import * as THREE from 'three';
import type { RigidBody } from '@react-three/rapier';

// =============================================================================
// OBJECT POOL
// =============================================================================

export interface IPoolable {
  /** Reset object to default state before reuse */
  reset(): void;
  /** Check if object is currently active */
  isActive(): boolean;
  /** Activate object */
  activate(): void;
  /** Deactivate object */
  deactivate(): void;
}

export interface PoolStats {
  totalObjects: number;
  activeObjects: number;
  inactiveObjects: number;
  hitRate: number;
}

export class ObjectPool<T extends IPoolable> {
  private objects: T[] = [];
  private factory: () => T;
  private initialSize: number;
  private hits = 0;
  private misses = 0;
  
  constructor(factory: () => T, initialSize: number = 10) {
    this.factory = factory;
    this.initialSize = initialSize;
    
    // Pre-warm pool
    this.prewarm(initialSize);
  }
  
  /** Pre-create objects to avoid runtime allocation */
  prewarm(count: number): void {
    for (let i = 0; i < count; i++) {
      const obj = this.factory();
      obj.deactivate();
      this.objects.push(obj);
    }
  }
  
  /** Acquire an object from the pool */
  acquire(): T {
    // Find inactive object
    for (const obj of this.objects) {
      if (!obj.isActive()) {
        obj.reset();
        obj.activate();
        this.hits++;
        return obj;
      }
    }
    
    // Pool exhausted - create new
    this.misses++;
    const obj = this.factory();
    obj.activate();
    this.objects.push(obj);
    return obj;
  }
  
  /** Release an object back to the pool */
  release(obj: T): void {
    obj.deactivate();
  }
  
  /** Release all objects */
  releaseAll(): void {
    for (const obj of this.objects) {
      obj.deactivate();
    }
  }
  
  /** Get pool statistics */
  getStats(): PoolStats {
    const active = this.objects.filter(o => o.isActive()).length;
    const total = this.objects.length;
    const totalRequests = this.hits + this.misses;
    
    return {
      totalObjects: total,
      activeObjects: active,
      inactiveObjects: total - active,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 1,
    };
  }
  
  /** Clear all objects */
  clear(): void {
    this.objects = [];
    this.hits = 0;
    this.misses = 0;
  }
}

// =============================================================================
// SPAWNABLE OBJECT BASE CLASS
// =============================================================================

export interface ObjectConfig {
  /** Object type identifier */
  type: string;
  /** Collider type */
  colliderType: 'box' | 'sphere' | 'capsule' | 'trimesh' | 'none';
  /** Is this a trigger (no physical collision) */
  isTrigger: boolean;
  /** Mass for physics objects */
  mass: number;
  /** Should this object be pooled */
  poolable: boolean;
  /** Lifetime in seconds (0 = infinite) */
  lifetime: number;
}

export abstract class SpawnableObject implements IPoolable {
  /** Unique instance ID */
  id: string;
  /** Current position */
  position: THREE.Vector3;
  /** Current rotation */
  rotation: THREE.Euler;
  /** Current scale */
  scale: THREE.Vector3;
  /** Configuration */
  config: ObjectConfig;
  /** Physics body (if applicable) */
  body: RigidBody | null = null;
  /** Three.js mesh */
  mesh: THREE.Mesh | null = null;
  
  private active = false;
  private createdAt = 0;
  
  constructor(config: Partial<ObjectConfig> = {}) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.position = new THREE.Vector3();
    this.rotation = new THREE.Euler();
    this.scale = new THREE.Vector3(1, 1, 1);
    this.config = {
      type: 'unknown',
      colliderType: 'none',
      isTrigger: false,
      mass: 1,
      poolable: true,
      lifetime: 0,
      ...config,
    };
    this.createdAt = performance.now();
  }
  
  reset(): void {
    this.position.set(0, 0, 0);
    this.rotation.set(0, 0, 0);
    this.scale.set(1, 1, 1);
    this.createdAt = performance.now();
    this.onReset();
  }
  
  activate(): void {
    this.active = true;
    this.createdAt = performance.now();
    this.onActivate();
  }
  
  deactivate(): void {
    this.active = false;
    this.onDeactivate();
  }
  
  isActive(): boolean {
    // Check lifetime
    if (this.active && this.config.lifetime > 0) {
      const age = (performance.now() - this.createdAt) / 1000;
      if (age > this.config.lifetime) {
        this.deactivate();
        return false;
      }
    }
    return this.active;
  }
  
  /** Called when object is reset - override in subclass */
  protected onReset(): void {}
  
  /** Called when object is activated - override in subclass */
  protected onActivate(): void {}
  
  /** Called when object is deactivated - override in subclass */
  protected onDeactivate(): void {}
  
  /** Update loop - override in subclass */
  update(delta: number): void {}
  
  /** Collision handler - override in subclass */
  onCollision(other: SpawnableObject): void {}
  
  /** Get transform matrix */
  getMatrix(): THREE.Matrix4 {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(this.rotation);
    matrix.compose(this.position, quaternion, this.scale);
    return matrix;
  }
}

// =============================================================================
// CONCRETE OBJECT IMPLEMENTATIONS
// =============================================================================

// -----------------------------------------------------------------------------
// LOG OBSTACLE
// -----------------------------------------------------------------------------

export interface LogConfig extends ObjectConfig {
  length: number;
  radius: number;
  buoyant: boolean;
}

export class LogObstacle extends SpawnableObject {
  private floatOffset = 0;
  
  constructor(config: Partial<LogConfig> = {}) {
    super({
      type: 'log',
      colliderType: 'capsule',
      mass: 2,
      ...config,
    });
    
    // Random start phase for floating
    this.floatOffset = Math.random() * Math.PI * 2;
  }
  
  protected onActivate(): void {
    // Logs bob in water
    this.floatOffset = Math.random() * Math.PI * 2;
  }
  
  update(delta: number): void {
    if (!this.isActive()) return;
    
    // Bobbing animation for logs in water
    const time = performance.now() * 0.001;
    const bob = Math.sin(time + this.floatOffset) * 0.1;
    
    if (this.mesh) {
      this.mesh.position.y = this.position.y + bob;
    }
    
    // Rotate slowly with current
    this.rotation.z += delta * 0.1;
  }
}

// -----------------------------------------------------------------------------
// RAMP (Jump pad)
// -----------------------------------------------------------------------------

export interface RampConfig extends ObjectConfig {
  jumpForce: number;
  angle: number;
}

export class Ramp extends SpawnableObject {
  jumpForce: number;
  
  constructor(config: Partial<RampConfig> = {}) {
    super({
      type: 'ramp',
      colliderType: 'trimesh',
      isTrigger: true,
      mass: 0, // Static
      ...config,
    });
    
    this.jumpForce = config.jumpForce || 15;
  }
  
  onCollision(other: SpawnableObject): void {
    // Apply jump force to colliding object
    if (other.body) {
      const impulse = new THREE.Vector3(0, this.jumpForce, -this.jumpForce * 0.5);
      other.body.applyImpulse(
        { x: impulse.x, y: impulse.y, z: impulse.z },
        true
      );
    }
  }
}

// -----------------------------------------------------------------------------
// COIN (Collectible)
// -----------------------------------------------------------------------------

export interface CoinConfig extends ObjectConfig {
  value: number;
  rotates: boolean;
}

export class Coin extends SpawnableObject {
  value: number;
  
  constructor(config: Partial<CoinConfig> = {}) {
    super({
      type: 'coin',
      colliderType: 'sphere',
      isTrigger: true,
      mass: 0,
      lifetime: 0,
      ...config,
    });
    
    this.value = config.value || 1;
  }
  
  update(delta: number): void {
    if (!this.isActive()) return;
    
    // Rotate coin
    this.rotation.y += delta * 2;
    
    // Bob slightly
    const time = performance.now() * 0.002;
    this.position.y += Math.sin(time) * 0.01;
  }
  
  onCollision(other: SpawnableObject): void {
    // Collect!
    this.deactivate();
    // SWARM: Trigger score event here
  }
}

// -----------------------------------------------------------------------------
// PARTICLE EFFECT (Splash, etc.)
// -----------------------------------------------------------------------------

export interface ParticleConfig extends ObjectConfig {
  particleCount: number;
  duration: number;
  size: number;
  color: string;
}

export class ParticleEffect extends SpawnableObject {
  private particles: THREE.Vector3[] = [];
  private velocities: THREE.Vector3[] = [];
  private colors: THREE.Color[] = [];
  
  constructor(config: Partial<ParticleConfig> = {}) {
    super({
      type: 'particles',
      colliderType: 'none',
      poolable: true,
      lifetime: config.duration || 1,
      ...config,
    });
    
    const count = config.particleCount || 10;
    for (let i = 0; i < count; i++) {
      this.particles.push(new THREE.Vector3());
      this.velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 2,
        (Math.random() - 0.5) * 2
      ));
      this.colors.push(new THREE.Color(config.color || '#ffffff'));
    }
  }
  
  protected onActivate(): void {
    // Reset particles to origin
    for (const p of this.particles) {
      p.set(0, 0, 0);
    }
  }
  
  update(delta: number): void {
    if (!this.isActive()) return;
    
    // Update particle positions
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].add(this.velocities[i].clone().multiplyScalar(delta));
      this.velocities[i].y -= 9.8 * delta; // Gravity
    }
  }
}

// =============================================================================
// OBJECT FACTORY
// =============================================================================

export function createSpawnableObject(type: string, config: Record<string, any> = {}): SpawnableObject {
  switch (type) {
    case 'log':
      return new LogObstacle(config);
    case 'ramp':
      return new Ramp(config);
    case 'coin':
      return new Coin(config);
    case 'particles':
      return new ParticleEffect(config);
    // SWARM: Add new object types here
    default:
      throw new Error(`Unknown spawnable object type: ${type}`);
  }
}
