/**
 * VehicleSystem.ts - Base vehicle abstraction for Watershed
 * 
 * RESPONSIBILITIES:
 * - Define common vehicle interface (runner, raft, future vehicles)
 * - Handle vehicle switching
 * - Coordinate with physics and input systems
 * 
 * SWARM: Extend BaseVehicle for new vehicle types (skis, kayak, etc.)
 */

import * as THREE from 'three';
import type { RigidBody } from '@react-three/rapier';

// =============================================================================
// CORE INTERFACES
// =============================================================================

export interface VehicleState {
  /** Current world position */
  position: THREE.Vector3;
  /** Current velocity */
  velocity: THREE.Vector3;
  /** Is vehicle on ground/water */
  isGrounded: boolean;
  /** Current speed magnitude */
  speed: number;
  /** Distance traveled this run */
  distance: number;
  /** Current flow speed multiplier */
  flowMultiplier: number;
}

export interface VehicleInput {
  /** Forward/backward input (-1 to 1) */
  moveY: number;
  /** Left/right input (-1 to 1) */
  moveX: number;
  /** Jump/trick input */
  jump: boolean;
  /** Sprint/boost input */
  sprint: boolean;
  /** Brake input */
  brake: boolean;
}

export interface VehicleConfig {
  /** Vehicle mass (kg) */
  mass: number;
  /** Linear damping (air/water resistance) */
  linearDamping: number;
  /** Angular damping (rotational resistance) */
  angularDamping: number;
  /** Friction coefficient */
  friction: number;
  /** Restitution (bounciness) */
  restitution: number;
  /** Base movement speed */
  baseSpeed: number;
  /** Sprint speed multiplier */
  sprintMultiplier: number;
  /** Jump impulse strength */
  jumpForce: number;
  /** Water flow responsiveness (0-1) */
  flowResponsiveness: number;
}

// =============================================================================
// BASE VEHICLE ABSTRACT CLASS
// =============================================================================

export abstract class BaseVehicle {
  /** Physics body reference */
  protected body: RigidBody | null = null;
  /** Current vehicle state */
  protected state: VehicleState;
  /** Vehicle configuration */
  protected config: VehicleConfig;
  /** Input state */
  protected input: VehicleInput;
  /** Distance tracking */
  protected lastPosition: THREE.Vector3;
  /** Ground check raycast */
  protected isGrounded: boolean = false;
  
  constructor(config: Partial<VehicleConfig> = {}) {
    this.config = this.getDefaultConfig();
    Object.assign(this.config, config);
    
    this.state = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      isGrounded: false,
      speed: 0,
      distance: 0,
      flowMultiplier: 1.0,
    };
    
    this.input = {
      moveY: 0,
      moveX: 0,
      jump: false,
      sprint: false,
      brake: false,
    };
    
    this.lastPosition = new THREE.Vector3();
  }
  
  /** Get default configuration - override in subclasses */
  protected abstract getDefaultConfig(): VehicleConfig;
  
  /** Initialize with physics body */
  initialize(body: RigidBody, startPosition?: THREE.Vector3): void {
    this.body = body;
    if (startPosition) {
      this.body.setTranslation(startPosition, true);
      this.lastPosition.copy(startPosition);
    }
  }
  
  /** Update input state */
  setInput(input: Partial<VehicleInput>): void {
    Object.assign(this.input, input);
  }
  
  /** Apply water flow force */
  applyFlowForce(flowDirection: THREE.Vector3, flowStrength: number): void {
    if (!this.body) return;
    
    const force = flowDirection.clone().multiplyScalar(
      flowStrength * this.config.flowResponsiveness
    );
    
    this.body.applyImpulse(
      { x: force.x, y: force.y, z: force.z },
      true
    );
  }
  
  /** Main update loop - called every frame */
  update(delta: number): void {
    if (!this.body) return;
    
    // Update state from physics
    const pos = this.body.translation();
    const vel = this.body.linvel();
    
    this.state.position.set(pos.x, pos.y, pos.z);
    this.state.velocity.set(vel.x, vel.y, vel.z);
    this.state.speed = this.state.velocity.length();
    
    // Track distance
    const moved = this.state.position.distanceTo(this.lastPosition);
    this.state.distance += moved;
    this.lastPosition.copy(this.state.position);
    
    // Ground check
    this.checkGrounded();
    
    // Apply vehicle-specific physics
    this.applyPhysics(delta);
    
    // Update state
    this.state.isGrounded = this.isGrounded;
  }
  
  /** Ground check using raycast */
  protected checkGrounded(): void {
    if (!this.body) {
      this.isGrounded = false;
      return;
    }
    
    const pos = this.body.translation();
    
    // Raycast down from body
    const rayOrigin = { x: pos.x, y: pos.y + 0.2, z: pos.z };
    const rayDir = { x: 0, y: -1, z: 0 };
    
    // Access Rapier world through body
    const world = (this.body as any).getWorld?.();
    if (world && window.RAPIER) {
      const ray = new window.RAPIER.Ray(rayOrigin, rayDir);
      const hit = world.castRay(ray, 1.5, true);
      this.isGrounded = !!hit;
    } else {
      // Fallback: check height above water
      this.isGrounded = pos.y < 2.0;
    }
  }
  
  /** Apply vehicle-specific physics - override in subclasses */
  protected abstract applyPhysics(delta: number): void;
  
  /** Get current state (immutable) */
  getState(): Readonly<VehicleState> {
    return { ...this.state };
  }
  
  /** Get configuration */
  getConfig(): Readonly<VehicleConfig> {
    return { ...this.config };
  }
  
  /** Cleanup resources */
  destroy(): void {
    this.body = null;
  }
}

// =============================================================================
// RUNNER VEHICLE (Sonic-style downhill)
// =============================================================================

export class RunnerVehicle extends BaseVehicle {
  protected getDefaultConfig(): VehicleConfig {
    return {
      mass: 1,
      linearDamping: 0.35,
      angularDamping: 0.9,
      friction: 0.04,
      restitution: 0.15,
      baseSpeed: 32,
      sprintMultiplier: 1.5,
      jumpForce: 22,
      flowResponsiveness: 14, // Strong auto-flow
    };
  }
  
  protected applyPhysics(delta: number): void {
    if (!this.body) return;
    
    // Auto river flow - always pushing forward
    this.body.applyImpulse(
      { x: 0, y: 0, z: -this.config.flowResponsiveness * delta },
      true
    );
    
    // Player movement
    const speed = this.input.sprint 
      ? this.config.baseSpeed * this.config.sprintMultiplier 
      : this.config.baseSpeed;
    
    // Camera-relative movement
    const forwardDir = this.getCameraForward();
    const rightDir = this.getCameraRight();
    
    if (this.input.moveY > 0) {
      this.body.applyImpulse({
        x: forwardDir.x * speed * delta,
        y: 0,
        z: forwardDir.z * speed * delta
      }, true);
    }
    if (this.input.moveY < 0) {
      this.body.applyImpulse({
        x: forwardDir.x * -speed * 0.6 * delta,
        y: 0,
        z: forwardDir.z * -speed * 0.6 * delta
      }, true);
    }
    if (this.input.moveX < 0) {
      this.body.applyImpulse({
        x: rightDir.x * -speed * 0.8 * delta,
        y: 0,
        z: rightDir.z * -speed * 0.8 * delta
      }, true);
    }
    if (this.input.moveX > 0) {
      this.body.applyImpulse({
        x: rightDir.x * speed * 0.8 * delta,
        y: 0,
        z: rightDir.z * speed * 0.8 * delta
      }, true);
    }
    
    // Jump
    if (this.input.jump && this.isGrounded) {
      this.body.applyImpulse(
        { x: 0, y: this.config.jumpForce, z: 0 },
        true
      );
    }
  }
  
  private getCameraForward(): THREE.Vector3 {
    // This will be injected from the React component
    // For now, return default forward
    return new THREE.Vector3(0, 0, -1);
  }
  
  private getCameraRight(): THREE.Vector3 {
    return new THREE.Vector3(1, 0, 0);
  }
}

// =============================================================================
// RAFT VEHICLE (Log flume style)
// =============================================================================

export class RaftVehicle extends BaseVehicle {
  protected getDefaultConfig(): VehicleConfig {
    return {
      mass: 5,
      linearDamping: 2.5,
      angularDamping: 3.0,
      friction: 0.1,
      restitution: 0.3,
      baseSpeed: 16,
      sprintMultiplier: 1.2, // Paddle boost
      jumpForce: 0, // Rafts can't jump
      flowResponsiveness: 4, // Follows flow more closely
    };
  }
  
  protected applyPhysics(delta: number): void {
    if (!this.body) return;
    
    // Stronger auto-flow for raft (water current)
    this.body.applyImpulse(
      { x: 0, y: 0, z: -this.config.flowResponsiveness * delta },
      true
    );
    
    // Add turbulence
    const time = performance.now() * 0.001;
    const turbulence = Math.sin(time) * 0.3;
    this.body.applyImpulse({
      x: turbulence * 0.5 * delta,
      y: turbulence * 0.2 * delta,
      z: turbulence * delta
    }, true);
    
    // Raft steering (slower than runner)
    const steerSpeed = this.config.baseSpeed * 0.3;
    
    if (this.input.moveX !== 0) {
      this.body.applyImpulse({
        x: this.input.moveX * steerSpeed * delta,
        y: 0,
        z: 0
      }, true);
      
      // Add rotation when steering
      this.body.applyTorqueImpulse({
        x: 0,
        y: -this.input.moveX * 2 * delta,
        z: 0
      }, true);
    }
    
    // Cap speed to prevent going supersonic
    const vel = this.body.linvel();
    if (Math.abs(vel.z) > 15) {
      this.body.setLinvel({
        x: vel.x,
        y: vel.y,
        z: 15 * Math.sign(vel.z)
      }, true);
    }
  }
}

// =============================================================================
// VEHICLE FACTORY
// =============================================================================

export type VehicleType = 'runner' | 'raft';

export function createVehicle(type: VehicleType, config?: Partial<VehicleConfig>): BaseVehicle {
  switch (type) {
    case 'runner':
      return new RunnerVehicle(config);
    case 'raft':
      return new RaftVehicle(config);
    default:
      throw new Error(`Unknown vehicle type: ${type}`);
  }
}
