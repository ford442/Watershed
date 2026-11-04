/**
 * The tile sampler (#487 D Phase A): `sampleTile` / `sampleBand` answer
 * "height, normal and band at (s, lateral)" in the tile's own datum.
 */

import { describe, expect, it } from 'vitest';
import {
  buildTerrainTile,
  buildWallShellTile,
  createTileSample,
  sampleBand,
  sampleTile,
  TerrainBand,
  TerrainProfile,
  TERRAIN_SLOT_FLOOR_LIFT,
  TileBranch,
  type TerrainTile,
} from '../terrainTile';
import { TERRAIN_FIXTURES, WALL_SHELL_FIXTURES } from './terrainFixtures';

const fixture = (name: string) => {
  const f = TERRAIN_FIXTURES.find((t) => t.name.includes(name));
  if (!f) throw new Error(name);
  return f;
};

const tileOf = (name: string): TerrainTile => {
  const tile = buildTerrainTile(fixture(name).params);
  if (!tile) throw new Error(name);
  return tile;
};

describe('sampleTile — at grid nodes it is the vertex', () => {
  for (const { name } of TERRAIN_FIXTURES) {
    it(name, () => {
      const tile = tileOf(name);
      const out = createTileSample();
      const cols = tile.segmentsX + 1;
      let checked = 0;
      for (let iz = 0; iz <= tile.segmentsZ; iz += 5) {
        for (let ix = 0; ix < cols; ix += 3) {
          const i = iz * cols + ix;
          // Unfolded columns only: on a fold the lowest branch is not necessarily this vertex.
          if (tile.x[i] !== tile.x[ix] && name.includes('tube')) continue;
          sampleTile(tile, iz / tile.segmentsZ, tile.x[i], out);
          expect(out.ok).toBe(true);
          if (!out.covered) {
            expect(Math.abs(out.y - tile.h[i])).toBeLessThanOrEqual(1e-5);
            checked += 1;
          }
        }
      }
      expect(checked).toBeGreaterThan(10);
    });
  }
});

describe('sampleTile — invariants', () => {
  it('normals are unit and face up on the floor branch', () => {
    for (const { name } of TERRAIN_FIXTURES) {
      const tile = tileOf(name);
      const out = createTileSample();
      const half = Math.abs(tile.x[0]);
      for (let k = 0; k <= 50; k += 1) {
        const s = k / 50;
        for (let l = -half; l <= half; l += 0.37) {
          if (!sampleTile(tile, s, l, out).ok) continue;
          expect(Math.abs(Math.hypot(out.nx, out.ny, out.nz) - 1)).toBeLessThan(1e-9);
          expect(out.ny).toBeGreaterThanOrEqual(-1e-9);
        }
      }
    }
  });

  it('a rigid vertical translation moves y by exactly that and leaves the normal', () => {
    const tile = tileOf('meander');
    const shifted = buildTerrainTile(fixture('meander').params)!;
    for (let i = 0; i < shifted.h.length; i += 1) shifted.h[i] += 64;
    const a = createTileSample();
    const b = createTileSample();
    for (const [s, l] of [[0.13, 3.1], [0.5, -9.7], [0.91, 12.4], [0.33, 0]] as const) {
      sampleTile(tile, s, l, a);
      sampleTile(shifted, s, l, b);
      expect(b.y - a.y).toBeCloseTo(64, 4);
      expect(b.nx).toBeCloseTo(a.nx, 5);
      expect(b.ny).toBeCloseTo(a.ny, 5);
      expect(b.nz).toBeCloseTo(a.nz, 5);
      expect(b.band).toBe(a.band);
    }
  });

  it('is off the tile outside its lateral range, and allocates nothing', () => {
    const tile = tileOf('meander');
    const out = createTileSample();
    expect(sampleTile(tile, 0.5, 1e3, out)).toBe(out);
    expect(out.ok).toBe(false);
    expect(sampleTile(tile, 0.5, Number.NaN, out).ok).toBe(false);
    expect(sampleBand(tile, 0.5, -1e3)).toBe(TerrainBand.RIM);
  });
});

describe('sampleBand', () => {
  it('open canyon: floor in the channel, bank then wall then rim going out', () => {
    const tile = tileOf('meander');
    expect(sampleBand(tile, 0.5, 0)).toBe(TerrainBand.FLOOR);
    expect(sampleBand(tile, 0.5, 3)).toBe(TerrainBand.FLOOR);
    expect(sampleBand(tile, 0.5, 8.5)).toBe(TerrainBand.BANK);
    expect(sampleBand(tile, 0.5, 15.5)).toBe(TerrainBand.WALL);
    expect(sampleBand(tile, 0.5, 17.4)).toBe(TerrainBand.RIM);
    expect(sampleBand(tile, 0.5, -17.4)).toBe(TerrainBand.RIM);
  });

  it('ice tube: crown above and floor-side below at the same lateral', () => {
    const tile = tileOf('tube');
    const lower = createTileSample();
    const upper = createTileSample();
    let found = 0;
    for (let l = 3.5; l < 12.5; l += 0.25) {
      sampleTile(tile, 0.5, l, lower, TileBranch.FLOOR);
      sampleTile(tile, 0.5, l, upper, TileBranch.CROWN);
      if (!lower.covered) continue;
      found += 1;
      expect(upper.band).toBe(TerrainBand.CROWN);
      expect(lower.band).not.toBe(TerrainBand.CROWN);
      expect(upper.y).toBeGreaterThan(lower.y);
      expect(upper.ny).toBeLessThanOrEqual(0);
      expect(lower.ny).toBeGreaterThanOrEqual(0);
    }
    expect(found).toBeGreaterThan(3);
    // The corridor itself is open to the sky.
    sampleTile(tile, 0.5, 0, lower);
    expect(lower.covered).toBe(false);
    expect(lower.band).toBe(TerrainBand.FLOOR);
  });

  it('slot profile: the lift is in the sampled height', () => {
    const { params } = fixture('slot');
    const tile = tileOf('slot');
    const out = createTileSample();
    sampleTile(tile, 0, 0, out);
    // Centre of row 0: 22 · 0.18 lowered by the lift, minus the authored floor depth.
    const ch = params.channel;
    const expected = 22 * 0.18 - ch[3] * 1.4 + ch[4] * 0.2 + 0.05 - TERRAIN_SLOT_FLOOR_LIFT;
    expect(out.y).toBeCloseTo(expected, 4);
    expect(tile.profile).toBe(TerrainProfile.SLOT);
  });
});

describe('buildWallShellTile', () => {
  it('carries the shell heights and samples as rim', () => {
    for (const f of WALL_SHELL_FIXTURES) {
      const tile = buildWallShellTile(f.params);
      expect(tile).not.toBeNull();
      if (!tile) continue;
      expect(tile.h[f.probe]).toBeCloseTo(f.probeY, 4);
      const out = createTileSample();
      const cols = tile.segmentsX + 1;
      const iz = Math.floor(f.probe / cols);
      sampleTile(tile, iz / tile.segmentsZ, tile.x[f.probe], out);
      expect(out.ok).toBe(true);
      expect(out.y).toBeCloseTo(f.probeY, 4);
      expect(out.band).toBe(TerrainBand.RIM);
    }
  });
});
