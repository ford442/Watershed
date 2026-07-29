/**
 * MapSystem path/spawn generation — deterministic treadmill segment builders.
 *
 * Extracted from MapSystem.ts (issue #313). Re-exported from MapSystem.ts.
 */

import * as THREE from 'three';
import { DEFAULT_BIOME_ID } from '../configs/biomes';
import type {
  BaseMapChunk,
  MapConfig,
  MapManager,
  SegmentProgressionConfig,
  SpawnData,
} from './MapSystem.types';

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

export const DEFAULT_SEGMENT_PROGRESSION: SegmentProgressionConfig = {
  biome: DEFAULT_BIOME_ID,
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
      progression.decorations || progression.launchShelf || progression.openFloor
        ? {
            decorations: progression.decorations,
            launchShelf: progression.launchShelf,
            openFloor: progression.openFloor,
          }
        : undefined,
    active: true,
  };

  return { chunk, progression };
}
