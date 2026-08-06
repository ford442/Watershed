/**
 * MapSystem type contracts — JSON level format, chunk shapes, progression config.
 *
 * Extracted from MapSystem.ts (issue #313) so map/registry PRs can touch types
 * without churning manager implementations. Re-exported from MapSystem.ts.
 */

import * as THREE from 'three';
import type { RapierRigidBody } from '@react-three/rapier';
import type { BiomeId } from '../configs/biomes';

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

/** Authored vortex drain field for hydro / pond set-pieces. */
export interface VortexConfig {
  /** Path parameter 0–1 along the segment curve (default 0.5). */
  centerT?: number;
  /** Lateral offset from centerline in meters. */
  lateralOffset?: number;
  radius: number;
  eyeRadius: number;
  pullStrength: number;
  spinStrength: number;
  downwardForce: number;
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
  /**
   * Force a vehicle swap when the player enters this segment
   * (e.g. raft at delta entry).
   */
  forceVehicle?: 'runner' | 'raft';
  slipperiness?: number;
  treeDensity?: number;
  rockDensity?: 'low' | 'medium' | 'high';
  /**
   * When true, TrackSegment skips the floor trimesh collider so the player
   * flies an air corridor (gap / broken trestle set-pieces).
   */
  openFloor?: boolean;
  /** Authored bridge/trestle — WashedOut forecast can force a gap. */
  hasBridge?: boolean;
  /** Optional vortex drain field (Hydro-Dam chamber / throat). */
  vortex?: VortexConfig;
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
  /** Canonical biome identifier */
  biome: BiomeId;
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
  /** Authored decoration / launch-shelf / gap config passed through to TrackSegment */
  config?: {
    decorations?: Record<string, number | DecorationPlacement[]>;
    launchShelf?: LaunchShelfConfig;
    openFloor?: boolean;
    hasBridge?: boolean;
    vortex?: VortexConfig;
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
  biome: BiomeId;
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
  /** Force vehicle swap on segment entry (delta raft launch, etc.). */
  forceVehicle?: 'runner' | 'raft';
  /** Authored decoration positions (array) or procedural density counts (number). */
  decorations?: Record<string, number | DecorationPlacement[]>;
  /** Optional launch-shelf gameplay trigger for waterfall set-pieces. */
  launchShelf?: LaunchShelfConfig;
  /**
   * When true, the segment is an air corridor — no floor trimesh collider.
   * Pair with a splash/pond landing segment for a playable gap jump.
   */
  openFloor?: boolean;
  /** Authored bridge/trestle — WashedOut forecast can force a gap. */
  hasBridge?: boolean;
  /** Optional vortex drain field (Hydro-Dam chamber / throat). */
  vortex?: VortexConfig;
  /**
   * Surface slipperiness 0–1. 0 = normal grip, 1 = frictionless ice.
   * Consumed by WaterFlowForces / RaftVehicle to reduce lateral drag and
   * add a persistent downstream slide bias when > 0.
   * TODO: wire into Rapier contact material override per segment.
   */
  slipperiness?: number;
}

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
