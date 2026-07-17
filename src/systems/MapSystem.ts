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
import type { RapierRigidBody } from '@react-three/rapier';

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

export interface DecorationPlacement {
  localX: number;
  localZ: number;
  scale?: number;
  rotation?: number;
  rockType?: 'boulder' | 'slab' | 'column';
}

export interface LevelSegment {
  index: number;
  name?: string;
  type?: 'normal' | 'waterfall' | 'pond' | 'splash' | 'rapids';
  biomeOverride?: string;
  difficulty: number;
  width?: number;
  waterWidth?: number;
  lengthMultiplier?: number;
  meanderStrength?: number;
  verticalBias?: number;
  forwardMomentum?: number;
  decorations?: Record<string, number | DecorationPlacement[]>;
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
  launchShelf?: LaunchShelfConfig;
  journeyComplete?: boolean;
  slipperiness?: number;
  treeDensity?: number;
  rockDensity?: 'low' | 'medium' | 'high';
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
  /** Authored decoration / launch-shelf config passed through to TrackSegment */
  config?: {
    decorations?: Record<string, number | DecorationPlacement[]>;
    launchShelf?: LaunchShelfConfig;
  };
  /** Reference to physics collider */
  collider?: RapierRigidBody;
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

/**
 * Seed polyline used to derive segment 0's start point and tangent.
 * The LAST point becomes segment 0's starting position (near player spawn).
 */
export const INITIAL_TREADMILL_POINTS = [
  new THREE.Vector3(-4, -8, 90),
  new THREE.Vector3(-2, -7, 60),
  new THREE.Vector3(-1, -6.5, 30),
  new THREE.Vector3(0, -6, 0),
];

// =============================================================================
// SEGMENT PROGRESSION CONFIG
// =============================================================================

/**
 * Per-segment configuration consumed by TrackManager to drive treadmill generation.
 * This is intentionally separate from BaseMapChunk: it is a lightweight config
 * object that describes HOW a segment should be built, not the built geometry.
 */
export interface LaunchShelfConfig {
  /** Reference to the authored rock that acts as the launch shelf.
   *  The trigger zone is derived from this rock's local placement. */
  rockRef: {
    localX: number;
    localZ: number;
    scale: number;
  };
  /** Trigger box half-extents in meters. */
  triggerHalfWidth: number;
  triggerHalfLength: number;
  triggerHeight: number;
  /** Distance downstream from the rock center to the trigger plane. */
  triggerDownstreamOffset: number;
  /** Vertical offset of the trigger center above the path surface. */
  triggerYOffset: number;
}

export interface SegmentProgressionConfig {
  biome: string;
  type: 'normal' | 'waterfall' | 'splash' | 'pond' | 'rapids';
  width: number;
  waterWidth: number;
  meanderStrength: number;
  verticalBias: number;
  flowSpeed: number;
  treeDensity: number;
  rockDensity: 'low' | 'medium' | 'high';
  forwardMomentum?: number;
  particleCount?: number;
  cameraShake?: number;
  /** Per-segment gravity scale applied to the Rapier world (1.0 = normal). */
  gravityMultiplier?: number;
  /** When true, entering this segment triggers the journey-complete sequence. */
  journeyComplete?: boolean;
  /** Authored decoration positions (array) or procedural density counts (number). */
  decorations?: Record<string, number | DecorationPlacement[]>;
  /** Optional launch-shelf gameplay trigger for waterfall set-pieces. */
  launchShelf?: LaunchShelfConfig;
  /**
   * Surface slipperiness 0–1. 0 = normal grip, 1 = frictionless ice.
   * Consumed by WaterFlowForces / RaftVehicle to reduce lateral drag and
   * add a persistent downstream slide bias when > 0.
   * TODO: wire into Rapier contact material override per segment.
   */
  slipperiness?: number;
}

export const DEFAULT_SEGMENT_PROGRESSION: SegmentProgressionConfig = {
  biome: 'summer',
  type: 'normal',
  width: 35,
  waterWidth: 10,
  meanderStrength: 1.2,
  verticalBias: -0.5,
  flowSpeed: 1,
  treeDensity: 1,
  rockDensity: 'low',
  slipperiness: 0,
};

/**
 * A single entry in a segment-progression override table.
 * Ranges are inclusive on both ends. If `indexTo` is omitted, the entry
 * matches all indices >= indexFrom (open-ended catch-all).
 * getChunkConfig uses "first match wins" — place more-specific ranges before
 * broader ones in the array.
 */
export interface SegmentRange {
  indexFrom: number;
  indexTo?: number;
  config: Partial<SegmentProgressionConfig>;
}

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
 * Generate a river path for a single treadmill segment.
 *
 * This is the ChunkManager-compatible variant of `generateRiverPath`:
 * it uses the segment's authored progression (meanderStrength, verticalBias,
 * type) and a configurable step distance to produce 4 Catmull-Rom control
 * points that connect end-to-end with the previous segment.
 */
export function generateSegmentPath(
  index: number,
  startPoint: THREE.Vector3,
  startDirection: THREE.Vector3,
  progression: SegmentProgressionConfig,
  seed: number,
  options: {
    stepCount?: number;
    stepDistanceMin?: number;
    stepDistanceMax?: number;
  } = {}
): THREE.Vector3[] {
  const rng = new SeededRandom(seed);
  const points: THREE.Vector3[] = [startPoint.clone()];

  let currentPos = startPoint.clone();
  let direction = startDirection.clone().normalize();

  const meanderStrength = progression.meanderStrength ?? DEFAULT_SEGMENT_PROGRESSION.meanderStrength;
  const verticalBias = progression.verticalBias ?? DEFAULT_SEGMENT_PROGRESSION.verticalBias;
  const type = progression.type ?? DEFAULT_SEGMENT_PROGRESSION.type;

  const stepCount = options.stepCount ?? 3;
  const stepDistanceMin = options.stepDistanceMin ?? 30;
  const stepDistanceMax = options.stepDistanceMax ?? 40;

  for (let step = 0; step < stepCount; step += 1) {
    const turnFactor = Math.sin(index * 0.5 + step) * meanderStrength;
    direction.x += turnFactor * 0.3 + (rng.next() - 0.5) * 0.2;
    direction.y += rng.next() * 0.2 + verticalBias * 0.2;

    const maxUpward = type === 'pond' ? -0.01 : -0.1;
    if (direction.y > maxUpward) direction.y = maxUpward;

    direction.normalize();

    if (type !== 'waterfall') {
      if (direction.z > -0.5) direction.z = -0.5;
    } else {
      direction.z = -0.12;
      direction.y = Math.min(direction.y, -0.92);
    }

    direction.normalize();

    const distance = stepDistanceMin + rng.next() * (stepDistanceMax - stepDistanceMin);
    currentPos.add(direction.clone().multiplyScalar(distance));
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

/**
 * Calculate spawn positions for a segment using its authored progression.
 *
 * Tree/rock counts are taken from `progression.decorations` when available
 * (matching the JSON level format), otherwise derived from `treeDensity` /
 * `rockDensity`. This is the shared helper used by both DefaultMapManager and
 * JSONMapManager so spawn placement has a single deterministic source.
 */
export function calculateSegmentSpawns(
  curve: THREE.CatmullRomCurve3,
  progression: SegmentProgressionConfig,
  index: number,
  seed: number
): SpawnData[] {
  const rng = new SeededRandom(seed + index * 1000);
  const spawns: SpawnData[] = [];

  const pathLength = curve.getLength();
  const steps = Math.max(1, Math.floor(pathLength / 2));

  const canyonWidth = progression.width ?? DEFAULT_SEGMENT_PROGRESSION.width;
  const waterWidth = progression.waterWidth ?? DEFAULT_SEGMENT_PROGRESSION.waterWidth;
  const decorations = progression.decorations || {};

  // Resolve counts. JSON-authored maps use integer decoration counts;
  // procedural fallback uses treeDensity / rockDensity normalized to counts.
  const treeCount =
    typeof decorations.trees === 'number'
      ? decorations.trees
      : Math.round((progression.treeDensity ?? DEFAULT_SEGMENT_PROGRESSION.treeDensity) * 8);
  const rockCount =
    typeof decorations.rocks === 'number'
      ? decorations.rocks
      : progression.rockDensity === 'high'
      ? 12
      : progression.rockDensity === 'medium'
      ? 6
      : 2;

  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();

    for (const side of [-1, 1]) {
      const bankStart = waterWidth / 2;

      // Trees
      const treeChance = treeCount / steps;
      if (rng.next() < treeChance) {
        const dist = bankStart + 4 + rng.next() * 8;
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
      const rockChance = rockCount / steps;
      if (rng.next() < rockChance) {
        const dist = bankStart + 1 + rng.next() * 4;
        const offset = binormal.clone().multiplyScalar(side * dist);
        const pos = point.clone().add(offset);

        const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
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
// TREADMILL SEGMENT BUILDER (shared by ChunkManager + DefaultMapManager)
// =============================================================================

function createSegmentCurve(
  points: THREE.Vector3[],
  type: SegmentProgressionConfig['type'],
): THREE.CatmullRomCurve3 {
  const tension = type === 'pond' ? 0.1 : 0.5;
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', tension);
}

/**
 * Forces the new segment's start tangent to match the previous segment's end
 * tangent. Eliminates NaNs in Catmull-Rom derivative math at segment joints.
 */
export function ensureTangentContinuity(
  prevPoints: THREE.Vector3[],
  newPoints: THREE.Vector3[],
): THREE.Vector3[] {
  if (!prevPoints || prevPoints.length < 2 || newPoints.length < 2) {
    return newPoints;
  }

  const lastTwo = prevPoints.slice(-2);
  const prevTangent = new THREE.Vector3()
    .subVectors(lastTwo[1], lastTwo[0])
    .normalize();

  if (!prevTangent.lengthSq() || !isFinite(prevTangent.x)) {
    console.warn('[ensureTangentContinuity] Invalid previous tangent, skipping');
    return newPoints;
  }

  const desiredStart = newPoints[0].clone().add(prevTangent.multiplyScalar(0.01));
  newPoints[0] = desiredStart;
  return newPoints;
}

export interface BuildProceduralSegmentOptions {
  seed?: number;
  baseSeed?: number;
  ensureContinuity?: boolean;
  initialPoints?: THREE.Vector3[];
}

/**
 * Build a single treadmill segment using MapManager progression config and
 * deterministic SeededRandom path/spawn placement.
 */
export function buildProceduralSegment(
  index: number,
  previousPoints: THREE.Vector3[] | null,
  mapManager: MapManager,
  options: BuildProceduralSegmentOptions = {},
): { chunk: BaseMapChunk; progression: SegmentProgressionConfig } {
  const progression = mapManager.getChunkConfig(index);
  const baseSeed = options.baseSeed ?? DEFAULT_MAP_CONFIG.seed;
  const seed = options.seed ?? baseSeed + index * 1000;
  const initialPoints = options.initialPoints ?? INITIAL_TREADMILL_POINTS;

  const lastPoints = previousPoints ?? initialPoints;
  const lastPoint = lastPoints[lastPoints.length - 1].clone();
  const prevPoint = (lastPoints[lastPoints.length - 2] ?? initialPoints[0]).clone();
  const startDirection = new THREE.Vector3().subVectors(lastPoint, prevPoint).normalize();

  let points = generateSegmentPath(index, lastPoint, startDirection, progression, seed);

  if (options.ensureContinuity && previousPoints) {
    points = ensureTangentContinuity(previousPoints, points);
  }

  const curve = createSegmentCurve(points, progression.type);
  const pathLength = curve.getLength();
  const centerPoint = curve.getPoint(0.5);
  const spawns = calculateSegmentSpawns(curve, progression, index, seed);

  const chunk: BaseMapChunk = {
    id: `chunk-${index}`,
    index,
    position: centerPoint,
    pathPoints: points,
    curve,
    length: pathLength,
    biome: progression.biome,
    flowSpeed: progression.flowSpeed,
    waterLevel: 0.5,
    waterWidth: progression.waterWidth,
    canyonWidth: progression.width,
    spawns,
    config:
      progression.decorations || progression.launchShelf
        ? { decorations: progression.decorations, launchShelf: progression.launchShelf }
        : undefined,
    active: true,
  };

  return { chunk, progression };
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
  /**
   * Return the lightweight progression config for a given segment index.
   * TrackManager uses this instead of inline getProgressionConfig() to determine
   * biome, type, width, meander, etc. for each generated segment.
   */
  getChunkConfig(index: number): SegmentProgressionConfig;
}

// =============================================================================
// PLACEHOLDER IMPLEMENTATION
// =============================================================================

export class DefaultMapManager implements MapManager {
  chunks: BaseMapChunk[] = [];
  currentChunkIndex = 0;
  private config: MapConfig;
  private nextChunkId = 0;
  private progression: SegmentRange[];

  constructor(config: Partial<MapConfig> = {}, progression: SegmentRange[] = []) {
    this.config = { ...DEFAULT_MAP_CONFIG, ...config };
    this.progression = progression;

    // Generate initial chunks
    for (let i = 0; i < this.config.chunksAhead + 1; i++) {
      this.chunks.push(this.generateChunk(i, this.chunks[this.chunks.length - 1]));
    }
  }

  /**
   * Return the lightweight SegmentProgressionConfig for the given index.
   * Iterates the progression array with "first match wins" semantics, so
   * callers should place more-specific ranges before broader catch-alls.
   */
  getChunkConfig(index: number): SegmentProgressionConfig {
    const base: SegmentProgressionConfig = { ...DEFAULT_SEGMENT_PROGRESSION };
    for (const range of this.progression) {
      const to = range.indexTo ?? Infinity;
      if (index >= range.indexFrom && index <= to) {
        return { ...base, ...range.config };
      }
    }
    return base;
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

  generateChunk(index: number, previousChunk?: BaseMapChunk): BaseMapChunk {
    const previousPoints = previousChunk?.pathPoints ?? null;
    const { chunk } = buildProceduralSegment(index, previousPoints, this, {
      seed: this.config.seed + index * 1000,
      ensureContinuity: !!previousChunk,
    });
    chunk.id = `chunk-${this.nextChunkId++}`;
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
      const previousChunk = this.chunks.find(c => c.index === maxIndex);
      this.chunks.push(this.generateChunk(maxIndex + 1, previousChunk));
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
// BIOME NAME MAPPING
// =============================================================================

/**
 * Maps JSON-authored long-form biome names to the short TrackBiomeId values
 * used internally by TrackManager. Shared by both JSONMapManager.generateChunk
 * and JSONMapManager.getChunkConfig to keep naming consistent.
 */
export const JSON_BIOME_NAME_MAP: Record<string, string> = {
  'creek-summer': 'summer',
  'creek-autumn': 'autumn',
  'alpine-spring': 'summer',
  'alpine-glacial': 'glacialMelt',
  'glacial-melt': 'glacialMelt',
  'canyon-sunset': 'slotCanyon',
  'midnight-mist': 'autumn',
};

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
  private fallbackManager: DefaultMapManager;

  constructor(levelData?: LevelData) {
    this.fallbackManager = new DefaultMapManager();
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
    const curve = new THREE.CatmullRomCurve3(
      pathPoints,
      false,
      'catmullrom',
      config.type === 'pond' ? 0.1 : 0.5
    );
    const pathLength = curve.getLength();
    const centerPoint = curve.getPoint(0.5);

    // Calculate spawns from the authored progression config
    const progression = this.getChunkConfig(index);
    const seed = 12345 + index * 1000;
    const spawns = calculateSegmentSpawns(curve, progression, index, seed);

    // Map biome type
    const biomeOverride = config.biomeOverride || this.levelData.world.biome.baseType;

    const chunk: BaseMapChunk = {
      id: `chunk-${this.nextChunkId++}`,
      index,
      position: centerPoint,
      pathPoints,
      curve,
      length: pathLength,
      biome: JSON_BIOME_NAME_MAP[biomeOverride] || 'summer',
      flowSpeed: config.physics?.waterFlowIntensity || this.levelData.world.biome.water.flowSpeed,
      waterLevel: 0.5,
      waterWidth: config.waterWidth ?? this.levelData.world.track.width ?? DEFAULT_MAP_CONFIG.waterWidth,
      canyonWidth: config.width || this.levelData.world.track.width || DEFAULT_MAP_CONFIG.canyonWidth,
      spawns,
      config: progression.decorations || progression.launchShelf
        ? { decorations: progression.decorations, launchShelf: progression.launchShelf }
        : undefined,
      active: true,
    };

    return chunk;
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

  /**
   * Map a LevelSegment entry to SegmentProgressionConfig.
   * Returns default values for any field not specified in the JSON.
   */
  getChunkConfig(index: number): SegmentProgressionConfig {
    const base: SegmentProgressionConfig = { ...DEFAULT_SEGMENT_PROGRESSION };
    if (!this.levelData) return this.fallbackManager.getChunkConfig(index);

    const totalSegments = this.levelData.world.track.totalSegments;
    const seg = this.levelData.segments.find(s => s.index === index);

    // Segments beyond the authored range fall back to procedural generation
    if (!seg) {
      if (index >= totalSegments) {
        return this.fallbackManager.getChunkConfig(index);
      }
      // Segment within authored range but no explicit entry — use defaults
      return base;
    }

    // Map JSON long-form biome name to internal short-form (e.g. 'creek-autumn' → 'autumn')
    const rawBiome = seg.biomeOverride ?? this.levelData.world.biome.baseType;
    const mappedBiome = JSON_BIOME_NAME_MAP[rawBiome] ?? rawBiome;

    // Derive rockDensity from decoration counts: >= 15 rocks → 'high'
    let rockDensity: SegmentProgressionConfig['rockDensity'] =
      seg.rockDensity ?? base.rockDensity;
    const rockDecorations = seg.decorations?.rocks;
    if (!seg.rockDensity && typeof rockDecorations === 'number') {
      rockDensity = rockDecorations >= 15 ? 'high' : 'low';
    }

    return {
      ...base,
      biome: mappedBiome,
      type: seg.type ?? base.type,
      width: seg.width ?? base.width,
      waterWidth: seg.waterWidth ?? base.waterWidth,
      meanderStrength: seg.meanderStrength ?? base.meanderStrength,
      verticalBias: seg.verticalBias ?? base.verticalBias,
      flowSpeed: seg.physics?.waterFlowIntensity ?? base.flowSpeed,
      treeDensity:
        seg.treeDensity ??
        (typeof seg.decorations?.trees === 'number'
          ? seg.decorations.trees
          : base.treeDensity),
      rockDensity,
      forwardMomentum: seg.forwardMomentum,
      particleCount: seg.effects?.particleCount,
      cameraShake: seg.effects?.cameraShake,
      gravityMultiplier: seg.physics?.gravityMultiplier,
      decorations: seg.decorations,
      launchShelf: seg.launchShelf,
      journeyComplete: seg.journeyComplete,
      slipperiness: seg.slipperiness,
    };
  }
}

// =============================================================================
// PROCEDURAL MAP MANAGER (JSON-authored config + procedural treadmill paths)
// =============================================================================

/**
 * Combines JSON level segment configs with procedural path generation.
 * Authored segments resolve via JSONMapManager.getChunkConfig; indices beyond
 * the authored sequence fall back to DefaultMapManager progression ranges.
 */
export class ProceduralMapManager implements MapManager {
  chunks: BaseMapChunk[] = [];
  currentChunkIndex = 0;
  private config: MapConfig;
  private levelData: LevelData | null;
  private jsonManager: JSONMapManager | null;
  private continuationManager: JSONMapManager | null;
  private continuationStartIndex: number;
  private fallbackManager: DefaultMapManager;

  constructor(
    levelData?: LevelData | null,
    fallbackProgression: SegmentRange[] = [],
    config: Partial<MapConfig> = {},
    continuation?: { levelData: LevelData; startIndex?: number } | null,
  ) {
    this.config = { ...DEFAULT_MAP_CONFIG, ...config };
    this.levelData = levelData ?? null;
    this.jsonManager = levelData ? new JSONMapManager(levelData) : null;
    this.continuationManager = continuation?.levelData
      ? new JSONMapManager(continuation.levelData)
      : null;
    this.continuationStartIndex = continuation?.startIndex ?? 0;
    this.fallbackManager = new DefaultMapManager(config, fallbackProgression);
  }

  getChunkConfig(index: number): SegmentProgressionConfig {
    if (this.jsonManager && this.levelData) {
      const totalSegments = this.levelData.world.track.totalSegments;
      const hasExplicit = this.levelData.segments.some((segment) => segment.index === index);
      if (hasExplicit || index < totalSegments) {
        return this.jsonManager.getChunkConfig(index);
      }
      if (this.continuationManager) {
        const continuationIndex = this.continuationStartIndex + (index - totalSegments);
        return this.continuationManager.getChunkConfig(continuationIndex);
      }
    }
    return this.fallbackManager.getChunkConfig(index);
  }

  getChunkAtPosition(position: THREE.Vector3): BaseMapChunk | null {
    return this.fallbackManager.getChunkAtPosition(position);
  }

  generateChunk(index: number, previousChunk?: BaseMapChunk): BaseMapChunk {
    const previousPoints = previousChunk?.pathPoints ?? null;
    const { chunk } = buildProceduralSegment(index, previousPoints, this, {
      seed: this.config.seed + index * 1000,
      ensureContinuity: !!previousChunk,
    });
    return chunk;
  }

  update(playerPosition: THREE.Vector3): void {
    this.fallbackManager.update(playerPosition);
    this.chunks = this.fallbackManager.chunks;
    this.currentChunkIndex = this.fallbackManager.currentChunkIndex;
  }

  getFlowAtPosition(position: THREE.Vector3): THREE.Vector3 {
    return this.fallbackManager.getFlowAtPosition(position);
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
    const chunk = this.pool.pop();
    if (chunk) {
      chunk.active = true;
      return chunk;
    }
    return {} as BaseMapChunk;
  }

  release(chunk: BaseMapChunk): void {
    chunk.active = false;
    delete chunk.curve;
    delete chunk.collider;
    this.pool.push(chunk);
  }

  get size(): number {
    return this.pool.length;
  }
}

