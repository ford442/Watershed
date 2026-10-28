/**
 * Terrain tile — goldens and invariants (#487 Phase A).
 *
 * The goldens in terrainFixtures.ts came from the retired C++ tile's host
 * build (emscripten/terrain_goldens.h, ABI 13–15), which this module matched
 * bit for bit; they now pin terrainTile.ts on its own.
 */

import { describe, expect, it } from 'vitest';
import type { ChannelProfileSample } from '../types';
import {
  applyTubeProfile,
  buildTerrainTile,
  buildWallShellHeights,
  canyonFloorFromShape,
  sampleChannelShape,
  packChannelProfile,
  TERRAIN_CHANNEL_STRIDE,
  TERRAIN_TILE_PLANES,
  TerrainProfile,
  terrainVertexCount,
  type TerrainTileParams,
} from '../terrainTile';
import { TERRAIN_FIXTURES, WALL_SHELL_FIXTURES } from './terrainFixtures';

function expectClose(actual: number, expected: number, label: string, rel = 1e-5, abs = 1e-4): void {
  const tol = Math.max(Math.abs(expected) * rel, abs);
  expect(Math.abs(actual - expected), `${label}: expected ${expected}, got ${actual}`).toBeLessThanOrEqual(tol);
}

const sum = (a: Float32Array, f: (v: number) => number = (v) => v): number => a.reduce((s, v) => s + f(v), 0);

describe('terrain tile — the goldens', () => {
  for (const { name, params, golden } of TERRAIN_FIXTURES) {
    it(name, () => {
      const tile = buildTerrainTile(params);
      expect(tile).not.toBeNull();
      if (!tile) return;
      expect(tile.vertexCount).toBe(terrainVertexCount(params.segmentsX, params.segmentsZ));
      expect(tile.planes.length).toBe(tile.vertexCount * TERRAIN_TILE_PLANES);
      expect(tile.planes.every(Number.isFinite)).toBe(true);
      expectClose(sum(tile.x, Math.abs), golden.sumAbsX, 'sum |X|');
      expectClose(sum(tile.h), golden.sumH, 'sum H');
      expectClose(sum(tile.bank), golden.sumBank, 'sum bank');
      expectClose(sum(tile.slopeX), golden.sumSlopeX, 'sum slopeX');
      expectClose(sum(tile.slopeZ), golden.sumSlopeZ, 'sum slopeZ');
      expectClose(sum(tile.slopeX, Math.abs), golden.sumAbsSlopeX, 'sum |slopeX|');
      for (const [i, h] of golden.probes) expectClose(tile.h[i], h, `H[${i}]`);
    });
  }

  for (const { name, params, sum: want, probe, probeY } of WALL_SHELL_FIXTURES) {
    it(`wall shell: ${name}`, () => {
      const shell = buildWallShellHeights(params);
      expect(shell).not.toBeNull();
      if (!shell) return;
      expectClose(sum(shell), want, 'sum');
      expectClose(shell[probe], probeY, 'probe');
    });
  }
});

describe('terrain tile — planes', () => {
  const [meander, , tube] = TERRAIN_FIXTURES;

  it('lays out flow-aligned uv: u across 0..1, v in metres downstream', () => {
    const tile = buildTerrainTile(meander.params)!;
    const cols = meander.params.segmentsX + 1;
    expect(tile.uvU[0]).toBe(0);
    expect(tile.uvU[cols - 1]).toBe(1);
    expect(tile.uvV[0]).toBe(0);
    expect(tile.uvV[tile.vertexCount - 1]).toBeCloseTo(meander.params.pathLength, 4);
  });

  it('marks the thalweg wet and the canyon edges as bank', () => {
    const tile = buildTerrainTile(meander.params)!;
    const cols = meander.params.segmentsX + 1;
    const mid = (meander.params.segmentsZ / 2) * cols;
    expect(tile.bank[mid + cols / 2 - 0.5]).toBe(0);
    expect(tile.bank[mid]).toBe(1);
    expect(tile.bank[mid + cols - 1]).toBe(1);
  });

  it('slopes are the finite difference of H', () => {
    const tile = buildTerrainTile(meander.params)!;
    const cols = meander.params.segmentsX + 1;
    const cellX = meander.params.canyonWidth / meander.params.segmentsX;
    const i = 30 * cols + 12;
    expect(tile.slopeX[i]).toBeCloseTo((tile.h[i + 1] - tile.h[i - 1]) / (2 * cellX), 5);
  });

  it('folds the ice tube into an overhang that lands on the crown', () => {
    const tile = buildTerrainTile(tube.params)!;
    const cols = tube.params.segmentsX + 1;
    const mid = (tube.params.segmentsZ / 2) * cols;
    expect(Math.abs(tile.x[mid])).toBeLessThan(Math.abs(tile.x[mid + 2]));
    expect(tile.h[mid]).toBeCloseTo(tube.params.tube!.ceilingHeight, 4);
  });

  it('rejects degenerate input instead of emitting NaN planes', () => {
    const base: TerrainTileParams = { ...meander.params };
    expect(buildTerrainTile({ ...base, pathLength: 0 })).toBeNull();
    expect(buildTerrainTile({ ...base, pathLength: Number.NaN })).toBeNull();
    expect(buildTerrainTile({ ...base, canyonWidth: 0 })).toBeNull();
    expect(buildTerrainTile({ ...base, segmentsX: 0 })).toBeNull();
    expect(buildTerrainTile({ ...base, segmentsZ: 5000 })).toBeNull();
    expect(buildWallShellHeights({ ...WALL_SHELL_FIXTURES[0].params, shellWidth: -1 })).toBeNull();
    // A denormal extent passes `> 0` and overflowed the slope planes to inf (TERRAIN_MIN_EXTENT).
    expect(buildTerrainTile({ ...base, canyonWidth: 1e-40 })).toBeNull();
    expect(buildTerrainTile({ ...base, pathLength: 1e-40 })).toBeNull();
    expect(buildWallShellHeights({ ...WALL_SHELL_FIXTURES[0].params, shellWidth: 1e-40 })).toBeNull();
  });
});

describe('terrain tile — one profile for every consumer', () => {
  const samples: ChannelProfileSample[] = Array.from({ length: 13 }, (_, i) => {
    const s = Math.sin(i * 1.3);
    return {
      t: i / 12,
      worldArc: i / 12,
      leftHalfWidth: 6 + s,
      rightHalfWidth: 6 - 0.7 * s,
      corridorHalfWidth: 4.33,
      floorDepth: 0.5 * s,
      floorWave: 0.1 * Math.cos(i),
      riffleStrength: Math.sin(i * 0.7),
      gravelBarSide: s > 0 ? 1 : -1,
      undercutSide: s > 0 ? -1 : 1,
      flowScale: 1,
    };
  });

  it('packs channel samples in the documented field order', () => {
    const packed = packChannelProfile(samples);
    expect(packed.length).toBe(samples.length * TERRAIN_CHANNEL_STRIDE);
    expect(packed[TERRAIN_CHANNEL_STRIDE + 6]).toBe(samples[1].gravelBarSide);
    expect(packed[TERRAIN_CHANNEL_STRIDE * 2 + 3]).toBeCloseTo(samples[2].floorDepth, 6);
  });

  it.each([
    ['open, no noise (the hull / SWE bed)', TerrainProfile.OPEN, false, null],
    ['slot, rock noise (the visual floor)', TerrainProfile.SLOT, true, null],
    ['ice tube', TerrainProfile.OPEN, true, { curl: 0.88, ceilingHeight: 9.5 }],
  ] as const)('the tile equals the per-point profile: %s', (_label, profile, rockNoise, tubeProfile) => {
    const params: TerrainTileParams = {
      pathLength: 84, canyonWidth: 28, waterWidth: 12, segmentsX: 20, segmentsZ: 42,
      profile, rockNoise, tube: tubeProfile, channel: packChannelProfile(samples),
    };
    const tile = buildTerrainTile(params)!;
    const cols = params.segmentsX + 1;
    for (let iz = 0; iz <= params.segmentsZ; iz += 3) {
      for (let ix = 0; ix < cols; ix += 1) {
        const i = iz * cols + ix;
        const x = ix * (params.canyonWidth / params.segmentsX) - params.canyonWidth / 2;
        const z = iz * (params.pathLength / params.segmentsZ) - params.pathLength / 2;
        const shape = sampleChannelShape(samples, params.waterWidth, iz / params.segmentsZ);
        const point = canyonFloorFromShape(
          x, z, params.canyonWidth, shape, profile === TerrainProfile.SLOT, rockNoise,
        );
        const folded = tubeProfile
          ? applyTubeProfile(x, point.yHeight, shape.corridorHalfWidth, params.canyonWidth / 2, tubeProfile)
          : { x, y: point.yHeight };
        // float32 channel packing + plane rounding, nothing more.
        expectClose(tile.h[i], folded.y, `h[${ix},${iz}]`, 1e-5, 1e-4);
        expectClose(tile.x[i], folded.x, `x[${ix},${iz}]`, 1e-5, 1e-4);
      }
    }
  });
});
