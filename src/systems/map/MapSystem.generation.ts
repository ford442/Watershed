/**
 * MapSystem path/spawn generation — deterministic treadmill segment builders.
 *
 * Extracted from MapSystem.ts (issue #313). Re-exported from MapSystem.ts.
 */

import * as THREE from 'three';
import { DEFAULT_BIOME_ID } from '../../configs/biomes';
import { createRng, rngInt } from '../../math/random';
import type {
  BaseMapChunk,
  MapConfig,
  MapManager,
  SegmentProgressionConfig,
  SpawnData,
} from './MapSystem.types';
import { WATER_LEVEL } from '../../constants/game';

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
 * Generate a river path for a single treadmill segment.
 *
 * It uses the segment's authored progression (meanderStrength, verticalBias,
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
  const rng = createRng(seed);
  const points: THREE.Vector3[] = [startPoint.clone()];

  const currentPos = startPoint.clone();
  const direction = startDirection.clone().normalize();

  const meanderStrength = progression.meanderStrength ?? DEFAULT_SEGMENT_PROGRESSION.meanderStrength;
  const verticalBias = progression.verticalBias ?? DEFAULT_SEGMENT_PROGRESSION.verticalBias;
  const type = progression.type ?? DEFAULT_SEGMENT_PROGRESSION.type;

  const stepCount = options.stepCount ?? 3;
  const stepDistanceMin = options.stepDistanceMin ?? 30;
  const stepDistanceMax = options.stepDistanceMax ?? 40;

  for (let step = 0; step < stepCount; step += 1) {
    const turnFactor = Math.sin(index * 0.5 + step) * meanderStrength;
    direction.x += turnFactor * 0.3 + (rng() - 0.5) * 0.2;
    direction.y += rng() * 0.2 + verticalBias * 0.2;

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

    const distance = stepDistanceMin + rng() * (stepDistanceMax - stepDistanceMin);
    currentPos.add(direction.clone().multiplyScalar(distance));
    points.push(currentPos.clone());
  }

  return points;
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
  const rng = createRng(seed + index * 1000);
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
      if (rng() < treeChance) {
        const dist = bankStart + 4 + rng() * 8;
        const offset = binormal.clone().multiplyScalar(side * dist);
        const pos = point.clone().add(offset);

        const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
        const height = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
        pos.y += height - 0.5;

        spawns.push({
          type: 'tree',
          position: pos,
          rotation: new THREE.Euler(0, rng() * Math.PI * 2, 0),
          scale: new THREE.Vector3(1.5, 1.5, 1.5).multiplyScalar(1 + rng() * 0.5),
          meta: { variant: rngInt(rng, 0, 3) }
        });
      }

      // Rocks
      const rockChance = rockCount / steps;
      if (rng() < rockChance) {
        const dist = bankStart + 1 + rng() * 4;
        const offset = binormal.clone().multiplyScalar(side * dist);
        const pos = point.clone().add(offset);

        const normalizedDist = Math.abs(side * dist) / (canyonWidth * 0.45);
        const height = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
        pos.y += height;

        spawns.push({
          type: 'rock',
          position: pos,
          rotation: new THREE.Euler(
            rng() * Math.PI,
            rng() * Math.PI,
            rng() * Math.PI
          ),
          scale: new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rng() * 0.8),
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
 * deterministic `createRng` path/spawn placement.
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
    waterLevel: WATER_LEVEL,
    waterWidth: progression.waterWidth,
    canyonWidth: progression.width,
    spawns,
    config:
      progression.decorations ||
      progression.launchShelf ||
      progression.openFloor ||
      progression.hasBridge ||
      progression.vortex
        ? {
            decorations: progression.decorations,
            launchShelf: progression.launchShelf,
            openFloor: progression.openFloor,
            hasBridge: progression.hasBridge,
            vortex: progression.vortex,
          }
        : undefined,
    active: true,
  };

  return { chunk, progression };
}
