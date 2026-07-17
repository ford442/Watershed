/**
 * MapSystem parity tests
 *
 * Validates that the MapSystem-driven treadmill is deterministic and that the
 * same seed + progression produces identical control points and spawn positions
 * across multiple runs. This is the contract gate for authored-map content:
 * a map must be "data + assets", not code surgery.
 */

import * as THREE from 'three';
import {
  ProceduralMapManager,
  calculateSegmentSpawns,
  generateSegmentPath,
} from '../MapSystem';
import { ChunkManager } from '../ChunkManager';
import meanderLevel from '../../maps/meander_to_waterfall.json';
import { MEANDER_FALLBACK_PROGRESSION } from '../../maps/meander_to_waterfall';
import type { LevelData } from '../MapSystem';

const SEED = 12345;
const meanderMap = meanderLevel as unknown as LevelData;

function createMapManager() {
  return new ProceduralMapManager(meanderMap, MEANDER_FALLBACK_PROGRESSION, { seed: SEED });
}

function pointsEqual(a: THREE.Vector3[], b: THREE.Vector3[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.distanceTo(b[i]) < 1e-6);
}

function spawnsEqual(a: ReturnType<typeof calculateSegmentSpawns>, b: ReturnType<typeof calculateSegmentSpawns>): boolean {
  if (a.length !== b.length) return false;
  return a.every((spawn, i) => {
    const other = b[i];
    return (
      spawn.type === other.type &&
      spawn.position.distanceTo(other.position) < 1e-6 &&
      spawn.scale.distanceTo(other.scale) < 1e-6
    );
  });
}

describe('MapSystem determinism / parity', () => {
  it('DefaultMapManager produces identical chunks for the same seed and progression', () => {
    const managerA = createMapManager();
    const managerB = createMapManager();

    // Advance both managers through the same player positions so they generate
    // the same set of chunks.
    for (let z = 0; z > -2500; z -= 120) {
      managerA.update(new THREE.Vector3(0, -10, z));
      managerB.update(new THREE.Vector3(0, -10, z));
    }

    const chunksA = managerA.chunks;
    const chunksB = managerB.chunks;

    expect(chunksA.length).toBeGreaterThan(0);
    expect(chunksA.length).toBe(chunksB.length);

    chunksA.forEach((chunkA, i) => {
      const chunkB = chunksB[i];
      expect(chunkA.index).toBe(chunkB.index);
      expect(chunkA.biome).toBe(chunkB.biome);
      expect(chunkA.flowSpeed).toBeCloseTo(chunkB.flowSpeed, 6);
      expect(chunkA.waterWidth).toBeCloseTo(chunkB.waterWidth, 6);
      expect(chunkA.canyonWidth).toBeCloseTo(chunkB.canyonWidth, 6);
      expect(pointsEqual(chunkA.pathPoints, chunkB.pathPoints)).toBe(true);
      expect(spawnsEqual(chunkA.spawns, chunkB.spawns)).toBe(true);
    });
  });

  it('generateSegmentPath is deterministic for the same inputs', () => {
    const mapManager = createMapManager();
    const progression = mapManager.getChunkConfig(14);
    const startPoint = new THREE.Vector3(0, -10, -400);
    const startDirection = new THREE.Vector3(0, -0.5, -1).normalize();

    const pointsA = generateSegmentPath(14, startPoint, startDirection, progression, SEED);
    const pointsB = generateSegmentPath(14, startPoint, startDirection, progression, SEED);

    expect(pointsA.length).toBe(4);
    expect(pointsEqual(pointsA, pointsB)).toBe(true);
  });

  it('calculateSegmentSpawns is deterministic for the same inputs', () => {
    const mapManager = createMapManager();
    const progression = mapManager.getChunkConfig(5);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -6, 0),
      new THREE.Vector3(2, -8, -30),
      new THREE.Vector3(-1, -10, -60),
      new THREE.Vector3(3, -12, -90),
    ]);

    const spawnsA = calculateSegmentSpawns(curve, progression, 5, SEED);
    const spawnsB = calculateSegmentSpawns(curve, progression, 5, SEED);

    expect(spawnsA.length).toBeGreaterThan(0);
    expect(spawnsEqual(spawnsA, spawnsB)).toBe(true);
  });

  it('ChunkManager produces identical active segments for the same seed and progression', () => {
    const mapManagerA = createMapManager();
    const mapManagerB = createMapManager();

    const chunkManagerA = new ChunkManager({ mapManager: mapManagerA, startIndex: -3 });
    const chunkManagerB = new ChunkManager({ mapManager: mapManagerB, startIndex: -3 });

    chunkManagerA.initializePool();
    chunkManagerB.initializePool();

    // Advance both treadmills by the same Z amounts.
    for (let z = 0; z > -1200; z -= 80) {
      chunkManagerA.update(z);
      chunkManagerB.update(z);
    }

    const activeA = chunkManagerA.getActiveSegments();
    const activeB = chunkManagerB.getActiveSegments();

    expect(activeA.length).toBeGreaterThan(0);
    expect(activeA.length).toBe(activeB.length);

    activeA.forEach((segA, i) => {
      const segB = activeB[i];
      expect(segA.id).toBe(segB.id);
      expect(segA.biome).toBe(segB.biome);
      expect(segA.type).toBe(segB.type);
      expect(segA.width).toBeCloseTo(segB.width, 6);
      expect(segA.flowSpeed).toBeCloseTo(segB.flowSpeed, 6);
      expect(pointsEqual(segA.points, segB.points)).toBe(true);
    });
  });

  it('waterfall segment (14) progression produces a steep vertical drop', () => {
    const mapManager = createMapManager();
    const progression = mapManager.getChunkConfig(14);

    expect(progression.type).toBe('waterfall');
    expect(progression.verticalBias).toBeLessThanOrEqual(-2.5);
    expect(progression.particleCount).toBe(400);

    const startPoint = new THREE.Vector3(0, -10, -400);
    const startDirection = new THREE.Vector3(0, -0.5, -1).normalize();
    const points = generateSegmentPath(14, startPoint, startDirection, progression, SEED);

    const totalDrop = points[0].y - points[points.length - 1].y;
    expect(totalDrop).toBeGreaterThan(2.5);

    // Forward progress should be dominated by vertical drop for a waterfall.
    const endTangent = new THREE.Vector3()
      .subVectors(points[points.length - 1], points[points.length - 2])
      .normalize();
    expect(endTangent.y).toBeLessThan(-0.8);
  });
});
