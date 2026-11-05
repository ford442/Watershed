/**
 * MapSystem.generation — the treadmill's segment builders as tables: seeded,
 * finite, and continuous at the joins (C0 within ensureTangentContinuity's
 * 0.01 nudge, tangents within a bounded turn).
 */
import * as THREE from 'three';
import {
  buildProceduralSegment,
  calculateSegmentSpawns,
  DEFAULT_SEGMENT_PROGRESSION,
  ensureTangentContinuity,
  generateSegmentPath,
  INITIAL_TREADMILL_POINTS,
  ProceduralMapManager,
  type LevelData,
  type SegmentProgressionConfig,
} from './MapSystem';
import meanderData from '../../maps/meander_to_waterfall.json';

const meander = meanderData as unknown as LevelData;

const finite = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const progression = (over: Partial<SegmentProgressionConfig> = {}): SegmentProgressionConfig => ({
  ...DEFAULT_SEGMENT_PROGRESSION,
  ...over,
});

const START = new THREE.Vector3(0, -6, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);

describe('generateSegmentPath', () => {
  it.each([
    ['normal', progression()],
    ['pond', progression({ type: 'pond', meanderStrength: 0.3 })],
    ['rapids', progression({ type: 'rapids', meanderStrength: 2.5, verticalBias: -1.5 })],
    ['waterfall', progression({ type: 'waterfall', verticalBias: -3 })],
  ])('%s: 4 finite points starting at the start point', (_name, prog) => {
    const points = generateSegmentPath(3, START, FORWARD, prog, 4242);
    expect(points).toHaveLength(4);
    expect(points.every(finite)).toBe(true);
    expect(points[0].equals(START)).toBe(true);
    expect(points[0]).not.toBe(START); // cloned, never aliased
  });

  it('is a pure function of (index, start, direction, progression, seed)', () => {
    const a = generateSegmentPath(5, START, FORWARD, progression(), 99);
    const b = generateSegmentPath(5, START, FORWARD, progression(), 99);
    const c = generateSegmentPath(5, START, FORWARD, progression(), 100);
    expect(a.map((p) => p.toArray())).toEqual(b.map((p) => p.toArray()));
    expect(c.map((p) => p.toArray())).not.toEqual(a.map((p) => p.toArray()));
  });

  it('always runs downhill and downstream', () => {
    for (const type of ['normal', 'pond', 'rapids', 'waterfall'] as const) {
      const points = generateSegmentPath(7, START, FORWARD, progression({ type }), 7);
      for (let i = 1; i < points.length; i++) {
        expect(points[i].y).toBeLessThan(points[i - 1].y);
        expect(points[i].z).toBeLessThan(points[i - 1].z);
      }
    }
  });

  it('respects stepCount and the step-distance range', () => {
    const points = generateSegmentPath(0, START, FORWARD, progression(), 1, {
      stepCount: 5,
      stepDistanceMin: 10,
      stepDistanceMax: 12,
    });
    expect(points).toHaveLength(6);
    for (let i = 1; i < points.length; i++) {
      const d = points[i].distanceTo(points[i - 1]);
      expect(d).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(d).toBeLessThanOrEqual(12 + 1e-9);
    }
  });

  it('a waterfall drops near-vertically', () => {
    const points = generateSegmentPath(14, START, FORWARD, progression({ type: 'waterfall' }), 3);
    const drop = points[0].y - points[3].y;
    const run = Math.abs(points[0].z - points[3].z);
    expect(drop).toBeGreaterThan(run * 3);
  });
});

describe('ensureTangentContinuity', () => {
  const prev = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -10)];

  it('nudges the new start 0.01 along the previous end tangent', () => {
    const next = [new THREE.Vector3(0, 0, -10), new THREE.Vector3(1, -1, -20)];
    const out = ensureTangentContinuity(prev, next);
    expect(out[0].toArray()).toEqual([0, 0, -10.01]);
    expect(out[1].toArray()).toEqual([1, -1, -20]);
  });

  it('is a no-op on fewer than two points either side', () => {
    const next = [new THREE.Vector3(1, 2, 3)];
    expect(ensureTangentContinuity(prev, next)[0].toArray()).toEqual([1, 2, 3]);
    const next2 = [new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6)];
    expect(ensureTangentContinuity([prev[0]], next2)[0].toArray()).toEqual([1, 2, 3]);
  });

  it('skips a degenerate previous tangent (coincident points)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const same = [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1)];
    const next = [new THREE.Vector3(5, 5, 5), new THREE.Vector3(6, 6, 6)];
    expect(ensureTangentContinuity(same, next)[0].toArray()).toEqual([5, 5, 5]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('calculateSegmentSpawns', () => {
  const curve = new THREE.CatmullRomCurve3(
    generateSegmentPath(2, START, FORWARD, progression(), 12345),
    false,
    'catmullrom',
    0.5,
  );

  it('is seeded: same inputs, same spawns', () => {
    const a = calculateSegmentSpawns(curve, progression(), 2, 777);
    const b = calculateSegmentSpawns(curve, progression(), 2, 777);
    expect(a).toEqual(b);
  });

  it('places finite spawns only', () => {
    const spawns = calculateSegmentSpawns(curve, progression({ rockDensity: 'high', treeDensity: 2 }), 2, 1);
    expect(spawns.length).toBeGreaterThan(0);
    for (const s of spawns) expect(finite(s.position)).toBe(true);
  });

  it('a denser progression places at least as many spawns', () => {
    const sparse = calculateSegmentSpawns(curve, progression({ rockDensity: 'low', treeDensity: 0 }), 2, 5);
    const dense = calculateSegmentSpawns(curve, progression({ rockDensity: 'high', treeDensity: 2 }), 2, 5);
    expect(dense.length).toBeGreaterThanOrEqual(sparse.length);
  });
});

describe('buildProceduralSegment — a seeded treadmill run', () => {
  function run(level: LevelData | null, count: number, baseSeed?: number) {
    const manager = new ProceduralMapManager(level);
    const chunks = [];
    let prev: THREE.Vector3[] | null = null;
    for (let i = 0; i < count; i++) {
      const { chunk } = buildProceduralSegment(i, prev, manager, {
        ensureContinuity: prev !== null,
        initialPoints: INITIAL_TREADMILL_POINTS,
        baseSeed,
      });
      chunks.push(chunk);
      prev = chunk.pathPoints;
    }
    return chunks;
  }

  it.each([
    ['procedural', null],
    ['meander', meander],
  ])('%s: finite chunks, continuous and tangent-continuous at every join', (_name, level) => {
    const chunks = run(level, 30);
    for (const chunk of chunks) {
      expect(chunk.pathPoints.every(finite)).toBe(true);
      expect(finite(chunk.position)).toBe(true);
      expect(Number.isFinite(chunk.length)).toBe(true);
      expect(chunk.length).toBeGreaterThan(0);
    }
    for (let i = 1; i < chunks.length; i++) {
      const a = chunks[i - 1].curve!;
      const b = chunks[i].curve!;
      expect(a.getPoint(1).distanceTo(b.getPoint(0))).toBeLessThanOrEqual(0.0101);
      const turn = a.getTangent(1).normalize().dot(b.getTangent(0).normalize());
      expect(turn).toBeGreaterThan(0.85);
    }
  });

  it('segment 0 starts at the last initial treadmill point', () => {
    const [first] = run(null, 1);
    expect(first.pathPoints[0].equals(INITIAL_TREADMILL_POINTS[INITIAL_TREADMILL_POINTS.length - 1])).toBe(true);
  });

  it('is deterministic for a base seed and changes with it', () => {
    const a = run(meander, 5, 1).map((c) => c.pathPoints.map((p) => p.toArray()));
    const b = run(meander, 5, 1).map((c) => c.pathPoints.map((p) => p.toArray()));
    const c = run(meander, 5, 2).map((ch) => ch.pathPoints.map((p) => p.toArray()));
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it('carries the authored progression onto the chunk', () => {
    const manager = new ProceduralMapManager(meander);
    const { chunk, progression: prog } = buildProceduralSegment(14, null, manager);
    expect(prog).toEqual(manager.getChunkConfig(14));
    expect(chunk.biome).toBe(prog.biome);
    expect(chunk.canyonWidth).toBe(prog.width);
    expect(chunk.waterWidth).toBe(prog.waterWidth);
    expect(chunk.index).toBe(14);
  });
});
