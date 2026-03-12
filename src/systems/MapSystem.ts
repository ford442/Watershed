/**
 * MapSystem.ts - Core map chunk management for Watershed
 * 
 * RESPONSIBILITIES:
 * - Define base chunk interface for all biomes
 * - Handle chunk lifecycle (load/update/unload)
 * - Coordinate chunk treadmill based on player position
 * - Load and parse JSON level files
 * 
 * SWARM: Extend BaseMapChunk for new biome-specific data
 */

import * as THREE from 'three';
import type { RigidBody } from '@react-three/rapier';

// =============================================================================
// JSON LEVEL FORMAT INTERFACES
// =============================================================================

export interface LevelMetadata {
  name: string;
  author: string;
  description?: string;
  difficulty: 'beginner' | 'intermediate' | 'expert' | 'custom';
  estimatedDuration: number;
  version: string;
  tags?: string[];
}

export interface LevelWorld {
  track: {
    waypoints: number[][];
    segmentLength: number;
    totalSegments: number;
    width?: number;
    wallHeight?: number;
  };
  biome: {
    baseType: string;
    sky: { color: string; cloudDensity?: number; cloudColor?: string };
    fog: { color: string; near: number; far: number; density?: number };
    lighting: {
      sunIntensity: number;
      sunAngle: number;
      sunColor?: string;
      ambientIntensity?: number;
      hemiSkyColor?: string;
      hemiGroundColor?: string;
    };
    water: { tint: string; flowSpeed: number; opacity?: number; surfaceRoughness?: number };
  };
}

export interface LevelSegment {
  index: number;
  name?: string;
  type?: 'normal' | 'waterfall' | 'pond' | 'splash' | 'rapids';
  biomeOverride?: string;
  difficulty: number;
  width?: number;
  lengthMultiplier?: number;
  meanderStrength?: number;
  verticalBias?: number;
  forwardMomentum?: number;
  decorations?: Record<string, number>;
  physics?: {
    gravityMultiplier?: number;
    waterFlowIntensity?: number;
    friction?: number;
    restitution?: number;
  };
  safeZone?: { yMin: number; yMax: number; respawnAt?: number };
  effects?: {
    particleCount?: number;
    cameraShake?: number;
    fogDensity?: number;
    transitionDuration?: number;
  };
}

export interface LevelSpawns {
  start: {
    position: number[];
    rotation?: number[];
    velocity?: number[];
  };
  checkpoints?: Array<{
    segment: number;
    position: number[];
    radius?: number;
  }>;
}

export interface LevelData {
  metadata: LevelMetadata;
  world: LevelWorld;
  segments: LevelSegment[];
  spawns: LevelSpawns;
  decorationPools?: Record<string, string[]>;
}

// =============================================================================
// CORE INTERFACES
// =============================================================================

export interface BaseMapChunk {
  /** Unique chunk identifier */
  id: string;
  /** Chunk sequence number (0 = start) */
  index: number;
  /** World-space center position */
  position: THREE.Vector3;
  /** Bezier/Catmull-Rom path points for river flow */
  pathPoints: THREE.Vector3[];
  /** Path curve (computed from pathPoints) */
  curve?: THREE.CatmullRomCurve3;
  /** Chunk length along Z axis */
  length: number;
  /** Biome identifier */
  biome: string;
  /** Flow speed multiplier (1.0 = normal) */
  flowSpeed: number;
  /** Water surface Y level */
  waterLevel: number;
  /** River width at water surface */
  waterWidth: number;
  /** Total canyon width (including banks) */
  canyonWidth: number;
  /** Pre-calculated spawn data for objects */
  spawns: SpawnData[];
  /** Reference to physics collider */
  collider?: RigidBody;
  /** Is this chunk currently visible/active */
  active: boolean;
}

export interface SpawnData {
  /** Object type identifier */
  type: string;
  /** Spawn position */
  position: THREE.Vector3;
  /** Spawn rotation */
  rotation: THREE.Euler;
  /** Spawn scale */
  scale: THREE.Vector3;
  /** Additional type-specific data */
  meta?: Record<string, any>;
}

export interface MapConfig {
  /** Number of chunks to keep ahead of player */
  chunksAhead: number;
  /** Number of chunks to keep behind player */
  chunksBehind: number;
  /** Base chunk length in meters */
  chunkLength: number;
  /** River width at water level */
  waterWidth: number;
  /** Total canyon width */
  canyonWidth: number;
  /** Default flow speed */
  baseFlowSpeed: number;
  /** Maximum slope angle (degrees) */
  maxSlope: number;
  /** Seed for reproducible generation */
  seed: number;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const DEFAULT_MAP_CONFIG: MapConfig = {
  chunksAhead: 3,
  chunksBehind: 1,
  chunkLength: 40,
  waterWidth: 10,
  canyonWidth: 35,
  baseFlowSpeed: 1.0,
  maxSlope: 30,
  seed: 12345,
};

// =============================================================================
// CHUNK GENERATION UTILITIES
// =============================================================================

/**
 * Seeded random number generator for reproducible chunks
 */
export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.nextRange(min, max + 1));
  }
}

/**
 * Generate a smooth river path with controlled meandering
 * SWARM: Override this in biome-specific generators for different path styles
 */
export function generateRiverPath(
  startPoint: THREE.Vector3,
  startDirection: THREE.Vector3,
  config: MapConfig,
  seed: number,
  meanderStrength: number = 1.0
): THREE.Vector3[] {
  const rng = new SeededRandom(seed);
  const points: THREE.Vector3[] = [startPoint.clone()];

  let currentPos = startPoint.clone();
  let direction = startDirection.clone().normalize();

  // Generate 4 control points for Catmull-Rom curve
  for (let i = 0; i < 3; i++) {
    // Meandering based on sine waves + randomness
    const meanderPhase = seed + i * 0.5;
    const turnFactor = Math.sin(meanderPhase) * meanderStrength * 0.3;

    // Add random variation
    direction.x += turnFactor + (rng.next() - 0.5) * 0.2;
    direction.y += (rng.next() * 0.2 - 0.1); // Slight elevation changes

    // Clamp upward slope
    if (direction.y > -0.1) direction.y = -0.1;

    // Ensure forward progress
    if (direction.z > -0.3) direction.z = -0.3;

    direction.normalize();

    // Step forward
    const stepDistance = config.chunkLength * (0.8 + rng.next() * 0.4);
    const step = direction.clone().multiplyScalar(stepDistance);
    currentPos.add(step);

    points.push(currentPos.clone());
  }

  return points;
}

/**
 * Calculate spawn positions along a river path
 * SWARM: Add new object types here
 */
export function calculateSpawns(
  curve: THREE.CatmullRomCurve3,
  chunkIndex: number,
  config: MapConfig,
  seed: number,
  density: { trees: number; rocks: number; collectibles: number }
): SpawnData[] {
  const rng = new SeededRandom(seed + chunkIndex * 1000);
  const spawns: SpawnData[] = [];

  const pathLength = curve.getLength();
  const steps = Math.floor(pathLength / 2); // Sample every 2 meters

  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();

    // Spawn on both sides
    for (const side of [-1, 1]) {
      const bankStart = config.waterWidth / 2;

      // Trees
      if (rng.next() < density.trees / steps) {
        const dist = bankStart + 4 + rng.next() * 8;
        const offset = binormal.clone().multiplyScalar(side * dist);
        const pos = point.clone().add(offset);

        // Height based on distance from center (bank slope)
        const normalizedDist = Math.abs(side * dist) / (config.canyonWidth * 0.45);
        const height = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
        pos.y += height - 0.5;

        spawns.push({
          type: 'tree',
          position: pos,
          rotation: new THREE.Euler(0, rng.next() * Math.PI * 2, 0),
          scale: new THREE.Vector3(1.5, 1.5, 1.5).multiplyScalar(1 + rng.next() * 0.5),
          meta: { variant: rng.nextInt(0, 3) }
        });
      }

      // Rocks (obstacles)
      if (rng.next() < density.rocks / steps) {
        const dist = bankStart + 1 + rng.next() * 4;
        const offset = binormal.clone().multiplyScalar(side * dist);
        const pos = point.clone().add(offset);

        const normalizedDist = Math.abs(side * dist) / (config.canyonWidth * 0.45);
        const height = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
        pos.y += height;

        spawns.push({
          type: 'rock',
          position: pos,
          rotation: new THREE.Euler(
            rng.next() * Math.PI,
            rng.next() * Math.PI,
            rng.next() * Math.PI
          ),
          scale: new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rng.next() * 0.8),
          meta: { collider: true }
        });
      }
    }
  }

  return spawns;
}

// =============================================================================
// MAP MANAGER INTERFACE
// =============================================================================

export interface MapManager {
  /** Current active chunks */
  chunks: BaseMapChunk[];
  /** Current player chunk index */
  currentChunkIndex: number;
  /** Get chunk at world position */
  getChunkAtPosition(position: THREE.Vector3): BaseMapChunk | null;
  /** Generate new chunk ahead */
  generateChunk(index: number): BaseMapChunk;
  /** Update chunk treadmill based on player position */
  update(playerPosition: THREE.Vector3): void;
  /** Get flow direction at position */
  getFlowAtPosition(position: THREE.Vector3): THREE.Vector3;
}

// =============================================================================
// PLACEHOLDER IMPLEMENTATION
// =============================================================================

export class DefaultMapManager implements MapManager {
  chunks: BaseMapChunk[] = [];
  currentChunkIndex = 0;
  private config: MapConfig;
  private nextChunkId = 0;

  constructor(config: Partial<MapConfig> = {}) {
    this.config = { ...DEFAULT_MAP_CONFIG, ...config };

    // Generate initial chunks
    for (let i = 0; i < this.config.chunksAhead + 1; i++) {
      this.chunks.push(this.generateChunk(i));
    }
  }

  getChunkAtPosition(position: THREE.Vector3): BaseMapChunk | null {
    // Find chunk whose path contains this position
    return this.chunks.find(chunk => {
      if (!chunk.curve) return false;
      // Simple distance check to chunk center
      const dist = chunk.position.distanceTo(position);
      return dist < chunk.length;
    }) || null;
  }

  generateChunk(index: number): BaseMapChunk {
    // SWARM: Override this in biome implementations
    const seed = this.config.seed + index * 1000;
    const rng = new SeededRandom(seed);

    const startPoint = index === 0
      ? new THREE.Vector3(0, -6, 30)
      : this.chunks[this.chunks.length - 1]?.pathPoints.slice(-1)[0] || new THREE.Vector3(0, -6, -index * this.config.chunkLength);

    const pathPoints = generateRiverPath(
      startPoint,
      new THREE.Vector3(0, -0.2, -1),
      this.config,
      seed,
      1.2 // meanderStrength
    );

    const curve = new THREE.CatmullRomCurve3(pathPoints, false, 'catmullrom', 0.5);
    const pathLength = curve.getLength();

    // Calculate center position
    const centerPoint = curve.getPoint(0.5);

    const chunk: BaseMapChunk = {
      id: `chunk-${this.nextChunkId++}`,
      index,
      position: centerPoint,
      pathPoints,
      curve,
      length: pathLength,
      biome: 'canyon',
      flowSpeed: this.config.baseFlowSpeed,
      waterLevel: 0.5,
      waterWidth: this.config.waterWidth,
      canyonWidth: this.config.canyonWidth,
      spawns: calculateSpawns(curve, index, this.config, seed, {
        trees: 0.3,
        rocks: 0.2,
        collectibles: 0.1
      }),
      active: true,
    };

    return chunk;
  }

  update(playerPosition: THREE.Vector3): void {
    // Find current chunk
    const currentChunk = this.getChunkAtPosition(playerPosition);
    if (currentChunk) {
      this.currentChunkIndex = currentChunk.index;
    }

    // Generate ahead if needed
    const maxIndex = Math.max(...this.chunks.map(c => c.index), 0);
    if (maxIndex < this.currentChunkIndex + this.config.chunksAhead) {
      this.chunks.push(this.generateChunk(maxIndex + 1));
    }

    // Remove far behind chunks
    this.chunks = this.chunks.filter(chunk =>
      chunk.index >= this.currentChunkIndex - this.config.chunksBehind
    );
  }

  getFlowAtPosition(position: THREE.Vector3): THREE.Vector3 {
    const chunk = this.getChunkAtPosition(position);
    if (!chunk?.curve) return new THREE.Vector3(0, 0, -1);

    // Find closest point on curve
    // Note: getUtoTmapping is expensive, consider caching
    const tangent = chunk.curve.getTangent(0.5); // Simplified
    return tangent;
  }
}

// =============================================================================
// JSON LEVEL LOADER
// =============================================================================

/**
 * Loads and parses JSON level files into MapSystem-compatible format
 */
export class JSONLevelLoader {
  /**
   * Fetch and parse a level from URL
   */
  static async loadFromUrl(url: string): Promise<LevelData> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load level: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return this.validateAndNormalize(data);
  }

  /**
   * Parse level data from object (already loaded JSON)
   */
  static loadFromObject(data: any): LevelData {
    return this.validateAndNormalize(data);
  }

  /**
   * Validate and normalize level data
   */
  private static validateAndNormalize(data: any): LevelData {
    if (!data.metadata || !data.world || !data.segments || !data.spawns) {
      throw new Error('Invalid level data: missing required sections (metadata, world, segments, spawns)');
    }

    // Ensure segments are sorted by index
    const segments = [...data.segments].sort((a: LevelSegment, b: LevelSegment) => a.index - b.index);

    // Normalize waypoints to Vector3
    const waypoints = data.world.track.waypoints.map((wp: number[]) => 
      new THREE.Vector3(wp[0], wp[1], wp[2])
    );

    // Create the main curve from waypoints
    const mainCurve = new THREE.CatmullRomCurve3(waypoints, false, 'catmullrom', 0.5);

    return {
      metadata: data.metadata,
      world: {
        ...data.world,
        track: {
          ...data.world.track,
          waypoints,
        },
      },
      segments,
      spawns: data.spawns,
      decorationPools: data.decorationPools,
    } as LevelData;
  }
}

// =============================================================================
// JSON-DRIVEN MAP MANAGER
// =============================================================================

/**
 * MapManager that loads chunks from JSON level data
 * Replaces inline generation with JSON-driven authoring
 */
export class JSONMapManager implements MapManager {
  chunks: BaseMapChunk[] = [];
  currentChunkIndex = 0;
  levelData: LevelData | null = null;
  private mainCurve: THREE.CatmullRomCurve3 | null = null;
  private nextChunkId = 0;

  constructor(levelData?: LevelData) {
    if (levelData) {
      this.loadLevel(levelData);
    }
  }

  /**
   * Load a new level
   */
  loadLevel(levelData: LevelData): void {
    this.levelData = levelData;
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.nextChunkId = 0;

    // Create main curve from waypoints
    const waypoints = levelData.world.track.waypoints as unknown as THREE.Vector3[];
    this.mainCurve = new THREE.CatmullRomCurve3(waypoints, false, 'catmullrom', 0.5);

    // Generate initial chunks
    const initialCount = Math.min(3, levelData.world.track.totalSegments);
    for (let i = 0; i < initialCount; i++) {
      this.chunks.push(this.generateChunk(i));
    }
  }

  /**
   * Load level from URL
   */
  async loadFromUrl(url: string): Promise<void> {
    const levelData = await JSONLevelLoader.loadFromUrl(url);
    this.loadLevel(levelData);
  }

  getChunkAtPosition(position: THREE.Vector3): BaseMapChunk | null {
    return this.chunks.find(chunk => {
      if (!chunk.curve) return false;
      const dist = chunk.position.distanceTo(position);
      return dist < chunk.length * 0.6;
    }) || null;
  }

  generateChunk(index: number): BaseMapChunk {
    if (!this.levelData || !this.mainCurve) {
      throw new Error('No level loaded');
    }

    const segmentConfig = this.levelData.segments.find(s => s.index === index);
    const totalSegments = this.levelData.world.track.totalSegments;
    
    if (!segmentConfig && index < totalSegments) {
      console.warn(`[MapSystem] No config for segment ${index}, using defaults`);
    }

    const config = segmentConfig || {
      index,
      difficulty: 0.5,
      type: 'normal' as const,
    };

    // Calculate segment bounds along the main curve
    const tStart = index / totalSegments;
    const tEnd = (index + 1) / totalSegments;

    // Sample points along curve for this segment
    const pathPoints: THREE.Vector3[] = [];
    const numPoints = 4;
    for (let i = 0; i < numPoints; i++) {
      const t = tStart + (tEnd - tStart) * (i / (numPoints - 1));
      pathPoints.push(this.mainCurve!.getPoint(Math.min(1, t)));
    }

    // Create segment curve
    const curve = new THREE.CatmullRomCurve3(pathPoints, false, 'catmullrom', 0.5);
    const pathLength = curve.getLength();
    const centerPoint = curve.getPoint(0.5);

    // Calculate spawns based on segment config
    const spawns = this.calculateSegmentSpawns(curve, config, index);

    // Map biome type
    const biomeOverride = config.biomeOverride || this.levelData.world.biome.baseType;
    const biomeMap: Record<string, string> = {
      'creek-summer': 'summer',
      'creek-autumn': 'autumn',
      'alpine-spring': 'summer',
      'canyon-sunset': 'autumn',
      'midnight-mist': 'autumn',
    };

    const chunk: BaseMapChunk = {
      id: `chunk-${this.nextChunkId++}`,
      index,
      position: centerPoint,
      pathPoints,
      curve,
      length: pathLength,
      biome: biomeMap[biomeOverride] || 'summer',
      flowSpeed: config.physics?.waterFlowIntensity || this.levelData.world.biome.water.flowSpeed,
      waterLevel: 0.5,
      waterWidth: this.levelData.world.track.waterWidth || 10,
      canyonWidth: config.width || this.levelData.world.track.width || 35,
      spawns,
      active: true,
    };

    return chunk;
  }

  private calculateSegmentSpawns(
    curve: THREE.CatmullRomCurve3,
    config: LevelSegment,
    index: number
  ): SpawnData[] {
    const spawns: SpawnData[] = [];
    const rng = new SeededRandom(index * 1000);
    const decorations = config.decorations || {};
    const pathLength = curve.getLength();
    const steps = Math.floor(pathLength / 2);

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();

      const canyonWidth = config.width || 35;
      const waterWidth = 10;

      for (const side of [-1, 1]) {
        // Trees
        const treeCount = decorations.trees || 0;
        const treeChance = treeCount / steps;
        if (rng.next() < treeChance) {
          const dist = waterWidth / 2 + 4 + rng.next() * 8;
          const offset = binormal.clone().multiplyScalar(side * dist);
          const pos = point.clone().add(offset);
          const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
          const height = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
          pos.y += height - 0.5;

          spawns.push({
            type: 'tree',
            position: pos,
            rotation: new THREE.Euler(0, rng.next() * Math.PI * 2, 0),
            scale: new THREE.Vector3(1.5, 1.5, 1.5).multiplyScalar(1 + rng.next() * 0.5),
            meta: { variant: rng.nextInt(0, 3) }
          });
        }

        // Rocks
        const rockCount = decorations.rocks || 0;
        const rockChance = rockCount / steps;
        if (rng.next() < rockChance) {
          const dist = waterWidth / 2 + 1 + rng.next() * 4;
          const offset = binormal.clone().multiplyScalar(side * dist);
          const pos = point.clone().add(offset);
          const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
          const height = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
          pos.y += height;

          spawns.push({
            type: 'rock',
            position: pos,
            rotation: new THREE.Euler(rng.next() * Math.PI, rng.next() * Math.PI, rng.next() * Math.PI),
            scale: new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rng.next() * 0.8),
            meta: { collider: true }
          });
        }
      }
    }

    return spawns;
  }

  update(playerPosition: THREE.Vector3): void {
    const currentChunk = this.getChunkAtPosition(playerPosition);
    if (currentChunk) {
      this.currentChunkIndex = currentChunk.index;
    }

    // Generate ahead if needed and within level bounds
    if (this.levelData) {
      const maxIndex = Math.max(...this.chunks.map(c => c.index), 0);
      const totalSegments = this.levelData.world.track.totalSegments;
      
      if (maxIndex < this.currentChunkIndex + 3 && maxIndex < totalSegments - 1) {
        this.chunks.push(this.generateChunk(maxIndex + 1));
      }
    }

    // Remove far behind chunks
    this.chunks = this.chunks.filter(chunk =>
      chunk.index >= this.currentChunkIndex - 1
    );
  }

  getFlowAtPosition(position: THREE.Vector3): THREE.Vector3 {
    const chunk = this.getChunkAtPosition(position);
    if (!chunk?.curve) return new THREE.Vector3(0, 0, -1);
    return chunk.curve.getTangent(0.5);
  }
}

// =============================================================================
// SIMPLE POOLING / CULLING UTILITIES
// =============================================================================

/**
 * Lightweight pool for reusing chunk objects instead of reallocating.
 * Biomes should call acquire() when creating and release() when recycling.
 *
 * // RAPTOR-MINI: plug this into biome managers for high-speed reuse.
 */
export class ChunkPool {
  private pool: BaseMapChunk[] = [];

  acquire(): BaseMapChunk {
    return this.pool.pop() || ({} as BaseMapChunk);
  }

  release(chunk: BaseMapChunk) {
    chunk.active = false;
    // clear expensive references to help GC
    delete chunk.curve;
    delete chunk.collider;
    this.pool.push(chunk);
  }
}

