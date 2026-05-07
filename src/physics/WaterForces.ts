/**
 * WaterForces.ts — Pure physics utility for water current calculations
 *
 * RESPONSIBILITIES:
 * - Sample flow maps at world positions
 * - Calculate flow forces based on flowmap + heightmap data
 * - Apply forces to Rapier RigidBody instances
 *
 * DESIGN:
 * - Stateless functions, no React / Three.js scene graph dependencies.
 * - Reusable between RaftVehicle, future water entities, and AI.
 * - All vector math uses Three.js math primitives for consistency.
 */

import * as THREE from 'three';
import type { RigidBody } from '@react-three/rapier';

// =============================================================================
// TYPES
// =============================================================================

export interface FlowMapData {
  /** Normalized flow vectors [u, v] in range [-1, 1] */
  data: Float32Array;
  width: number;
  height: number;
}

export interface WaterForceConfig {
  /** Base flow speed multiplier (m/s) */
  flowSpeed: number;
  /** Maximum force magnitude */
  maxForce: number;
  /** Turbulence amplitude (0-1) */
  turbulence: number;
  /** Turbulence frequency (Hz) */
  turbulenceFreq: number;
}

// =============================================================================
// DEFAULTS
// =============================================================================

export const DEFAULT_WATER_FORCE_CONFIG: WaterForceConfig = {
  flowSpeed: 1.0,
  maxForce: 14,
  turbulence: 0.15,
  turbulenceFreq: 2.0,
};

// =============================================================================
// FLOW MAP SAMPLING
// =============================================================================

/**
 * Sample the flow map at a world-space position.
 *
 * The flow map is assumed to be axis-aligned in the XZ plane and tiled.
 * Returns a normalized 2D flow vector [u, v] where:
 *   u = flow along X (-1 = left, +1 = right)
 *   v = flow along Z (-1 = backward, +1 = forward)
 */
export function sampleFlowMap(
  worldPos: THREE.Vector3,
  flowMap: FlowMapData
): THREE.Vector2 {
  if (!flowMap || !flowMap.data || flowMap.width === 0 || flowMap.height === 0) {
    return new THREE.Vector2(0, -1); // Default downstream flow
  }

  // Wrap coordinates to flow map bounds (tiling)
  const x = ((worldPos.x % flowMap.width) + flowMap.width) % flowMap.width;
  const z = ((worldPos.z % flowMap.height) + flowMap.height) % flowMap.height;

  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  // Clamp to valid indices
  const x0 = Math.max(0, Math.min(flowMap.width - 1, ix));
  const x1 = Math.max(0, Math.min(flowMap.width - 1, ix + 1));
  const z0 = Math.max(0, Math.min(flowMap.height - 1, iz));
  const z1 = Math.max(0, Math.min(flowMap.height - 1, iz + 1));

  // Bilinear sample
  const idx00 = (z0 * flowMap.width + x0) * 2;
  const idx10 = (z0 * flowMap.width + x1) * 2;
  const idx01 = (z1 * flowMap.width + x0) * 2;
  const idx11 = (z1 * flowMap.width + x1) * 2;

  const u00 = flowMap.data[idx00];
  const v00 = flowMap.data[idx00 + 1];
  const u10 = flowMap.data[idx10];
  const v10 = flowMap.data[idx10 + 1];
  const u01 = flowMap.data[idx01];
  const v01 = flowMap.data[idx01 + 1];
  const u11 = flowMap.data[idx11];
  const v11 = flowMap.data[idx11 + 1];

  const u =
    u00 * (1 - fx) * (1 - fz) +
    u10 * fx * (1 - fz) +
    u01 * (1 - fx) * fz +
    u11 * fx * fz;

  const v =
    v00 * (1 - fx) * (1 - fz) +
    v10 * fx * (1 - fz) +
    v01 * (1 - fx) * fz +
    v11 * fx * fz;

  return new THREE.Vector2(u, v);
}

// =============================================================================
// FORCE CALCULATION
// =============================================================================

/**
 * Calculate the water flow force at a given world position.
 *
 * Combines flow map sampling with configurable turbulence to produce
 * a force vector suitable for application to a physics body.
 *
 * @param position — World-space position
 * @param flowMap — Optional flow map data
 * @param config — Force configuration
 * @param time — Current elapsed time (for turbulence animation)
 * @returns Force vector in Newtons (game-scaled)
 */
export function calculateFlowForce(
  position: THREE.Vector3,
  flowMap: FlowMapData | null,
  config: Partial<WaterForceConfig> = {},
  time = 0
): THREE.Vector3 {
  const cfg = { ...DEFAULT_WATER_FORCE_CONFIG, ...config };

  // Base flow direction from flow map (or default downstream)
  const flow = flowMap
    ? sampleFlowMap(position, flowMap)
    : new THREE.Vector2(0, -1);

  // Convert 2D flow to 3D vector (XZ plane)
  const baseDirection = new THREE.Vector3(flow.x, 0, flow.y).normalize();

  // Scale by flow speed
  const baseForce = baseDirection.multiplyScalar(cfg.flowSpeed);

  // Add turbulence
  const turbX =
    Math.sin(time * cfg.turbulenceFreq + position.z * 0.5) * cfg.turbulence;
  const turbZ =
    Math.cos(time * cfg.turbulenceFreq * 1.3 + position.x * 0.5) * cfg.turbulence;

  const turbulence = new THREE.Vector3(turbX, 0, turbZ);

  const totalForce = baseForce.add(turbulence);

  // Clamp to max force
  if (totalForce.length() > cfg.maxForce) {
    totalForce.normalize().multiplyScalar(cfg.maxForce);
  }

  return totalForce;
}

/**
 * Calculate the buoyancy force for a partially submerged body.
 *
 * Formula: F_buoyancy = ρ_water * V_displaced * g
 *
 * @param submergedRatio — 0 (dry) to 1 (fully submerged)
 * @param volume — Total volume of the body (m³)
 * @param waterDensity — Density of water (kg/m³), default 1000
 * @param gravity — Gravitational acceleration (m/s²), default 9.80665
 * @returns Buoyancy force magnitude in Newtons
 */
export function calculateBuoyancyForce(
  submergedRatio: number,
  volume: number,
  waterDensity = 1000,
  gravity = 9.80665
): number {
  if (submergedRatio <= 0) return 0;
  const displacedVolume = volume * Math.min(1, submergedRatio);
  return waterDensity * displacedVolume * gravity;
}

/**
 * Calculate drag force on a body moving through water.
 *
 * Formula: F_drag = 0.5 * ρ * v² * C_d * A
 *
 * @param velocity — Current velocity vector
 * @param dragCoefficient — C_d (default 0.47 for blunt body)
 * @param crossSectionalArea — Frontal area in m²
 * @param waterDensity — Default 1000 kg/m³
 * @returns Drag force vector (opposes velocity)
 */
export function calculateDragForce(
  velocity: THREE.Vector3,
  dragCoefficient = 0.47,
  crossSectionalArea = 0.6,
  waterDensity = 1000
): THREE.Vector3 {
  const speed = velocity.length();
  if (speed < 0.001) return new THREE.Vector3(0, 0, 0);

  const magnitude =
    0.5 * waterDensity * speed * speed * dragCoefficient * crossSectionalArea;

  return velocity.clone().normalize().multiplyScalar(-magnitude);
}

// =============================================================================
// RAPIER INTEGRATION
// =============================================================================

/**
 * Apply a force vector to a Rapier RigidBody.
 *
 * @param body — Rapier RigidBody reference
 * @param force — Force vector in Newtons
 * @param delta — Frame delta time (seconds)
 * @param wake — Whether to wake the body (default true)
 */
export function applyWaterForce(
  body: RigidBody,
  force: THREE.Vector3,
  delta: number,
  wake = true
): void {
  if (!body || !body.applyImpulse) return;

  // applyImpulse takes an impulse (force * time)
  body.applyImpulse(
    {
      x: force.x * delta,
      y: force.y * delta,
      z: force.z * delta,
    },
    wake
  );
}

/**
 * Apply buoyancy as an upward impulse.
 *
 * @param body — Rapier RigidBody reference
 * @param submergedRatio — 0 to 1
 * @param volume — Body volume (m³)
 * @param delta — Frame delta time
 * @param waterDensity — Default 1000
 * @param gravity — Default 9.80665
 */
export function applyBuoyancyForce(
  body: RigidBody,
  submergedRatio: number,
  volume: number,
  delta: number,
  waterDensity = 1000,
  gravity = 9.80665
): void {
  if (!body || submergedRatio <= 0) return;

  const force = calculateBuoyancyForce(submergedRatio, volume, waterDensity, gravity);
  body.applyImpulse({ x: 0, y: force * delta, z: 0 }, true);
}

/**
 * Apply drag force to a Rapier RigidBody.
 *
 * @param body — Rapier RigidBody reference
 * @param dragCoefficient — Default 0.47
 * @param crossSectionalArea — Default 0.6 m²
 * @param waterDensity — Default 1000
 * @param delta — Frame delta time
 */
export function applyDragForce(
  body: RigidBody,
  dragCoefficient = 0.47,
  crossSectionalArea = 0.6,
  waterDensity = 1000,
  delta = 1 / 60
): void {
  if (!body || !body.linvel) return;

  const vel = body.linvel();
  const velocity = new THREE.Vector3(vel.x, vel.y, vel.z);
  const force = calculateDragForce(velocity, dragCoefficient, crossSectionalArea, waterDensity);

  body.applyImpulse(
    {
      x: force.x * delta,
      y: force.y * delta,
      z: force.z * delta,
    },
    true
  );
}

export default {
  sampleFlowMap,
  calculateFlowForce,
  calculateBuoyancyForce,
  calculateDragForce,
  applyWaterForce,
  applyBuoyancyForce,
  applyDragForce,
};
