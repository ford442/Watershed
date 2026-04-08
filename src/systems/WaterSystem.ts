/**
 * WaterSystem.ts - Water flow, turbulence, and splash effects
 * 
 * RESPONSIBILITIES:
 * - Calculate water flow at any position
 * - Manage water surface geometry
 * - Handle splash particle effects
 * - Biome-specific water behavior (calm, rapids, waterfall)
 * 
 * SWARM: Add new water types (whirlpool, standing wave, etc.)
 */

import * as THREE from 'three';
import type { BaseMapChunk } from './MapSystem';
import { WATER_DENSITY, AIR_DENSITY, WATER_VISCOSITY, GRAVITY } from '../constants/game';

// =============================================================================
// CORE INTERFACES
// =============================================================================

export interface WaterFlow {
  /** Flow direction (normalized) */
  direction: THREE.Vector3;
  /** Flow speed magnitude */
  speed: number;
  /** Turbulence amount (0-1) */
  turbulence: number;
  /** Water surface Y level */
  surfaceY: number;
  /** Is this deep water (affects buoyancy) */
  isDeep: boolean;
}

export interface SplashEffect {
  /** Position of splash */
  position: THREE.Vector3;
  /** Splash intensity (affects particle count) */
  intensity: number;
  /** Splash type */
  type: 'entry' | 'exit' | 'impact' | 'wake';
  /** Time created */
  timestamp: number;
}

export interface WaterConfig {
  /** Base water color */
  baseColor: string;
  /** Deep water color */
  deepColor: string;
  /** Foam color */
  foamColor: string;
  /** Base flow speed */
  baseFlowSpeed: number;
  /** Turbulence factor */
  turbulence: number;
  /** Water level Y */
  waterLevel: number;
  /** River width */
  waterWidth: number;
  /** Wave amplitude */
  waveHeight: number;
  /** Wave frequency */
  waveFrequency: number;
}

// =============================================================================
// BIOME WATER CONFIGURATIONS
// =============================================================================

export const WATER_CONFIGS: Record<string, WaterConfig> = {
  canyon: {
    baseColor: '#1a6b8a',
    deepColor: '#0d4a5e',
    foamColor: '#dff4ff',
    baseFlowSpeed: 1.2,
    turbulence: 0.3,
    waterLevel: 0.5,
    waterWidth: 10,
    waveHeight: 0.15,
    waveFrequency: 0.5,
  },
  pond: {
    baseColor: '#1a4b6a',
    deepColor: '#0d2d3d',
    foamColor: '#c8e8f5',
    baseFlowSpeed: 0.3,
    turbulence: 0.1,
    waterLevel: 0.5,
    waterWidth: 45,
    waveHeight: 0.05,
    waveFrequency: 0.3,
  },
  waterfall: {
    baseColor: '#5a9db0',
    deepColor: '#2d5a6b',
    foamColor: '#ffffff',
    baseFlowSpeed: 3.0,
    turbulence: 0.9,
    waterLevel: 0.5,
    waterWidth: 10,
    waveHeight: 0.4,
    waveFrequency: 1.2,
  },
  rapids: {
    baseColor: '#4a8a9a',
    deepColor: '#2d5a6a',
    foamColor: '#e8f8ff',
    baseFlowSpeed: 2.0,
    turbulence: 0.8,
    waterLevel: 0.5,
    waterWidth: 10,
    waveHeight: 0.25,
    waveFrequency: 0.8,
  },
  // SWARM: Add new biome water configs here
};

// =============================================================================
// WATER FLOW COMPONENT
// =============================================================================

export class WaterFlowComponent {
  private chunks: Map<string, BaseMapChunk>;
  private config: WaterConfig;
  private activeSplashes: SplashEffect[] = [];
  
  constructor(chunks: Map<string, BaseMapChunk>, biome: string = 'canyon') {
    this.chunks = chunks;
    this.config = WATER_CONFIGS[biome] || WATER_CONFIGS.canyon;
  }
  
  /** Set current biome (updates water config) */
  setBiome(biome: string): void {
    this.config = WATER_CONFIGS[biome] || WATER_CONFIGS.canyon;
  }
  
  /** Calculate water flow at world position */
  getFlowAt(position: THREE.Vector3): WaterFlow {
    // Find chunk containing this position
    let chunk: BaseMapChunk | null = null;
    let chunkT = 0;
    
    for (const c of this.chunks.values()) {
      if (!c.curve) continue;
      
      // Simple bounding check first
      const distToCenter = position.distanceTo(c.position);
      if (distToCenter < c.length / 2 + c.canyonWidth / 2) {
        chunk = c;
        // Find closest point on curve
        // Note: getUtoTmapping is expensive, using approximation
        chunkT = 0.5; // Simplified
        break;
      }
    }
    
    if (!chunk || !chunk.curve) {
      // Default flow when not over water
      return {
        direction: new THREE.Vector3(0, 0, -1),
        speed: this.config.baseFlowSpeed,
        turbulence: this.config.turbulence,
        surfaceY: this.config.waterLevel,
        isDeep: false,
      };
    }
    
    // Get flow direction from curve tangent
    const tangent = chunk.curve.getTangent(chunkT);
    const direction = tangent.normalize();
    
    // Adjust speed based on slope
    const slope = -direction.y; // Positive when going downhill
    const adjustedSpeed = this.config.baseFlowSpeed * (1 + slope * 2);
    
    // Calculate distance from river center
    const toCenter = new THREE.Vector2(position.x, position.z).distanceTo(
      new THREE.Vector2(chunk.position.x, chunk.position.z)
    );
    
    // Check if in water
    const isDeep = toCenter < chunk.waterWidth / 2;
    
    return {
      direction,
      speed: adjustedSpeed * chunk.flowSpeed,
      turbulence: this.config.turbulence * (isDeep ? 1 : 0.5),
      surfaceY: chunk.waterLevel,
      isDeep,
    };
  }
  
  /** Check if position is in water */
  isInWater(position: THREE.Vector3): boolean {
    const flow = this.getFlowAt(position);
    return position.y < flow.surfaceY && flow.isDeep;
  }
  
  /** Create splash effect */
  createSplash(position: THREE.Vector3, type: SplashEffect['type'], intensity: number = 1): SplashEffect {
    const splash: SplashEffect = {
      position: position.clone(),
      intensity,
      type,
      timestamp: performance.now(),
    };
    
    this.activeSplashes.push(splash);
    
    // Limit splash count
    if (this.activeSplashes.length > 50) {
      this.activeSplashes.shift();
    }
    
    return splash;
  }
  
  /** Get active splashes (for rendering) */
  getActiveSplashes(): SplashEffect[] {
    // Filter out old splashes
    const now = performance.now();
    this.activeSplashes = this.activeSplashes.filter(s => now - s.timestamp < 2000);
    return this.activeSplashes;
  }
  
  /** Apply water drag to velocity
   * 
   * Physics basis: Drag force in water is approximately 800x higher than in air
   * due to the density difference (ρ_water ≈ 1000 kg/m³ vs ρ_air ≈ 1.2 kg/m³).
   * 
   * Formula: F_drag = 0.5 * ρ * v² * Cd * A
   * - ρ (rho): fluid density
   * - v: velocity magnitude
   * - Cd: drag coefficient (raft ≈ 0.47, human ≈ 1.0)
   * - A: cross-sectional area
   * 
   * This simplified version applies a drag factor that simulates the 
   * high-resistance feel of moving through water without full physics calc.
   * 
   * @param velocity - Current velocity vector
   * @param delta - Time step in seconds
   * @returns Velocity with drag applied
   */
  applyDrag(velocity: THREE.Vector3, delta: number): THREE.Vector3 {
    // 50% drag per second - tuned for game feel
    // In reality, water drag would be much more severe, but this provides
    // better playability while maintaining the "water resistance" feel
    const dragFactor = 1 - (0.5 * delta);
    return velocity.multiplyScalar(dragFactor);
  }
  
  /** Get water density for physics calculations (kg/m³) */
  getDensity(): number {
    return WATER_DENSITY;
  }
  
  /** Get air density for above-water physics (kg/m³) */
  getAirDensity(): number {
    return AIR_DENSITY;
  }
  
  /** Calculate drag force magnitude using F_d = 0.5 * ρ * v² * C_d * A
   * @param velocity - Object velocity (m/s)
   * @param dragCoefficient - Shape-dependent drag coefficient
   * @param crossSectionalArea - Frontal area (m²)
   * @param inWater - Whether object is in water (true) or air (false)
   * @returns Drag force magnitude (N)
   */
  calculateDragForce(
    velocity: THREE.Vector3, 
    dragCoefficient: number, 
    crossSectionalArea: number,
    inWater: boolean = true
  ): number {
    const rho = inWater ? WATER_DENSITY : AIR_DENSITY;
    const speed = velocity.length();
    return 0.5 * rho * speed * speed * dragCoefficient * crossSectionalArea;
  }
  
  /** Calculate buoyancy force: F_b = ρ_water * V_displaced * g
   * @param submergedVolume - Volume displaced (m³)
   * @returns Buoyancy force (N)
   */
  calculateBuoyancyForce(submergedVolume: number): number {
    return WATER_DENSITY * submergedVolume * GRAVITY;
  }
  
  /** Get Reynolds number for flow characterization
   * Re = (ρ * v * L) / μ
   * Re < 2300: Laminar flow
   * Re > 4000: Turbulent flow
   * @param velocity - Flow velocity (m/s)
   * @param characteristicLength - Object length scale (m)
   */
  calculateReynoldsNumber(velocity: number, characteristicLength: number): number {
    return (WATER_DENSITY * velocity * characteristicLength) / WATER_VISCOSITY;
  }
  
  /** Get water surface height at position */
  getSurfaceHeight(position: THREE.Vector3): number {
    const flow = this.getFlowAt(position);
    return flow.surfaceY;
  }
  
  /** Update chunks reference (call when chunks change) */
  updateChunks(chunks: Map<string, BaseMapChunk>): void {
    this.chunks = chunks;
  }
}

// =============================================================================
// SHADER UNIFORMS GENERATOR
// =============================================================================

export function createWaterUniforms(config: WaterConfig, time: number) {
  return {
    time: { value: time },
    flowSpeed: { value: config.baseFlowSpeed },
    waterColor: { value: new THREE.Color(config.baseColor) },
    deepColor: { value: new THREE.Color(config.deepColor) },
    foamColor: { value: new THREE.Color(config.foamColor) },
    turbulence: { value: config.turbulence },
    waveHeight: { value: config.waveHeight },
  };
}

// =============================================================================
// WATER GEOMETRY GENERATOR
// =============================================================================

export function createWaterGeometry(
  curve: THREE.CatmullRomCurve3,
  width: number,
  segmentsZ: number
): THREE.PlaneGeometry {
  const pathLength = curve.getLength();
  const segmentsX = 4;
  
  const geo = new THREE.PlaneGeometry(width, pathLength, segmentsX, segmentsZ);
  geo.rotateX(-Math.PI / 2);
  
  const positions = geo.attributes.position;
  
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    
    // Map local Z to curve position
    const t = (z + pathLength / 2) / pathLength;
    const safeT = Math.max(0, Math.min(1, t));
    
    const point = curve.getPoint(safeT);
    
    positions.setXYZ(i, point.x + x, point.y, point.z);
  }
  
  geo.computeVertexNormals();
  return geo;
}
