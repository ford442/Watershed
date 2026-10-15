/**
 * Terrain tile fixtures (#487) — the TS copy of `emscripten/terrain_goldens.h`.
 *
 * The same three segments and the same golden sums are asserted by the host
 * smoke (C++), `emscripten/smoke_test.mjs` (the WASM build) and
 * `terrainTile.test.ts` (the TS mirror). Change all three together.
 */

import {
  TerrainProfile,
  type TerrainTileParams,
  type WallShellParams,
} from '../terrainTile';

export interface TerrainGolden {
  sumAbsX: number;
  sumH: number;
  sumBank: number;
  sumSlopeX: number;
  sumSlopeZ: number;
  sumAbsSlopeX: number;
  probes: readonly [index: number, h: number][];
}

export interface TerrainFixture {
  name: string;
  params: TerrainTileParams;
  golden: TerrainGolden;
}

// [left, right, corridor, floorDepth, floorWave, riffle, gravelBarSide, undercutSide, flowScale]
const MEANDER_CHANNEL = [
  7.4, 6.6, 4.9, 0.55, 0.06, -0.4, 1, -1, 0.95,
  7.9, 6.2, 4.9, 0.2, -0.1, 0.3, 1, -1, 1.05,
  6.8, 7.3, 4.9, -0.1, 0.12, 0.8, -1, 1, 1.14,
  6.1, 7.8, 4.9, 0.75, 0.02, -0.7, -1, 1, 0.92,
  7.0, 7.0, 4.9, 0.4, -0.05, -0.1, 1, -1, 0.99,
];

const SLOT_CHANNEL = [
  4.6, 3.9, 3.2, 1.1, 0.08, -0.6, 1, -1, 0.93,
  4.1, 4.4, 3.2, 0.3, -0.12, 0.5, -1, 1, 1.09,
  3.9, 4.8, 3.2, 1.4, 0.15, -1.0, -1, 1, 0.88,
  4.4, 4.0, 3.2, -0.2, 0.0, 0.9, 1, -1, 1.16,
];

const TUBE_CHANNEL = [
  5.2, 4.8, 3.5, 0.6, 0.04, -0.5, 1, -1, 0.94,
  4.6, 5.4, 3.5, 0.1, -0.08, 0.6, -1, 1, 1.11,
  5.0, 5.0, 3.5, 0.35, 0.1, 0.0, 1, -1, 1.0,
];

export const TERRAIN_FIXTURES: readonly TerrainFixture[] = [
  {
    name: 'summer meander',
    params: {
      pathLength: 96, canyonWidth: 35, waterWidth: 14, segmentsX: 40, segmentsZ: 96,
      profile: TerrainProfile.OPEN, rockNoise: true, tube: null,
      channel: new Float32Array(MEANDER_CHANNEL),
    },
    golden: {
      sumAbsX: 35647.5, sumH: 19824.7554, sumBank: 2423,
      sumSlopeX: -18.5166114, sumSlopeZ: 17.8918346, sumAbsSlopeX: 4612.35603,
      probes: [[1988, 0.214000002], [1998, 2.5464499], [2008, 24.8384438]],
    },
  },
  {
    name: 'slot canyon (collision grid)',
    params: {
      pathLength: 110, canyonWidth: 24, waterWidth: 8, segmentsX: 10, segmentsZ: 27,
      profile: TerrainProfile.SLOT, rockNoise: false, tube: null,
      channel: new Float32Array(SLOT_CHANNEL),
    },
    golden: {
      sumAbsX: 2016.00003, sumH: 8351.60272, sumBank: 223,
      sumSlopeX: 56.1832799, sumSlopeZ: 2.37521822, sumAbsSlopeX: 1189.26742,
      probes: [[148, 2.90555549], [151, 32.1523018], [153, 55.5884781]],
    },
  },
  {
    name: 'glacial ice tube',
    params: {
      pathLength: 90, canyonWidth: 25, waterWidth: 10, segmentsX: 40, segmentsZ: 90,
      profile: TerrainProfile.OPEN, rockNoise: true, tube: { curl: 0.88, ceilingHeight: 9.5 },
      channel: new Float32Array(TUBE_CHANNEL),
    },
    golden: {
      sumAbsX: 17952.578, sumH: 18642.1421, sumBank: 2276,
      sumSlopeX: 0.349430895, sumSlopeZ: 10.8422007, sumAbsSlopeX: 3021.99134,
      probes: [[1865, -0.105999999], [1848, 9.47856712], [1883, 9.68077946]],
    },
  },
];

export interface WallShellFixture {
  name: string;
  params: WallShellParams;
  sum: number;
  probe: number;
  probeY: number;
}

export const WALL_SHELL_FIXTURES: readonly WallShellFixture[] = [
  {
    name: 'summer shell',
    params: { pathLength: 96, shellWidth: 52.5, segmentsX: 24, segmentsZ: 48, profile: TerrainProfile.OPEN, wallHeight: 0, segmentId: 7 },
    sum: 23614.6625, probe: 612, probeY: 15.238183,
  },
  {
    name: 'slot shell',
    params: { pathLength: 110, shellWidth: 22.08, segmentsX: 24, segmentsZ: 55, profile: TerrainProfile.SLOT, wallHeight: 26, segmentId: 21 },
    sum: 35516.3319, probe: 700, probeY: 24.9836178,
  },
];
