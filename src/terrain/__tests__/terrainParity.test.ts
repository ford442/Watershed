/**
 * Terrain parity — C++ (emscripten/terrain.cpp) vs the TS mirror (#487 Phase A).
 *
 * The tile will be built in the sim worker from WASM (#487 B) and by the
 * mirror on a no-WASM boot, so the canyon a player rides must not depend on
 * which one ran. Every plane of every vertex must agree within 1e-5
 * (relative, absolute floor 1e-5): both compute in float64 and round once.
 *
 * Opt-in like waterForceParity.test.ts: `pnpm test:wasm` (WATERSHED_WASM_INTEGRATION=1).
 */

import type { WatershedNativeModule } from '../../systems/water/wasmAbi';
import { loadNativeFromDisk, nativePairOnDisk } from '../../testing/nativeFromDisk';
import {
  buildTerrainTile,
  buildTerrainTileNative,
  buildWallShellHeights,
  buildWallShellHeightsNative,
  TERRAIN_CHANNEL_STRIDE,
  TERRAIN_TILE_PLANES,
  TerrainProfile,
  type TerrainTileParams,
  type WallShellParams,
} from '../terrainTile';
import { TERRAIN_FIXTURES, WALL_SHELL_FIXTURES } from './terrainFixtures';

const runNative = process.env.WATERSHED_WASM_INTEGRATION === '1' && nativePairOnDisk();
const describeNative = runNative ? describe : describe.skip;

const PARITY_EPS = 1e-5;
const PLANE_NAMES = ['x', 'h', 'bank', 'slopeX', 'slopeZ', 'uvU', 'uvV'];

/** Deterministic LCG so a failure names a reproducible case. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomParams(seed: number): TerrainTileParams {
  const r = rng(seed);
  const waterWidth = 6 + r() * 30;
  const canyonWidth = waterWidth + 8 + r() * 30;
  const pathLength = 60 + r() * 120;
  const samples = 4 + Math.floor(r() * 60);
  const channel = new Float32Array(samples * TERRAIN_CHANNEL_STRIDE);
  for (let i = 0; i < samples; i += 1) {
    const o = i * TERRAIN_CHANNEL_STRIDE;
    const corridor = Math.max(3.2, waterWidth * 0.35);
    channel.set([
      corridor + 0.8 + r() * waterWidth * 0.4,
      corridor + 0.8 + r() * waterWidth * 0.4,
      corridor,
      r() * 1.6 - 0.4,
      r() * 0.5 - 0.25,
      r() * 2 - 1,
      r() < 0.5 ? -1 : 1,
      r() < 0.5 ? -1 : 1,
      0.8 + r() * 0.4,
    ], o);
  }
  const tubed = r() < 0.3;
  return {
    pathLength,
    canyonWidth,
    waterWidth,
    segmentsX: 4 + Math.floor(r() * 60),
    segmentsZ: 2 + Math.floor(r() * pathLength),
    profile: r() < 0.3 ? TerrainProfile.SLOT : TerrainProfile.OPEN,
    rockNoise: r() < 0.5,
    tube: tubed ? { curl: r(), ceilingHeight: 6 + r() * 6 } : null,
    channel,
  };
}

/** Worst plane mismatch, or null when every value is within PARITY_EPS. */
function firstMismatch(native: Float32Array, mirror: Float32Array, n: number): string | null {
  for (let i = 0; i < native.length; i += 1) {
    const a = native[i];
    const b = mirror[i];
    if (!(Math.abs(a - b) <= PARITY_EPS * Math.max(1, Math.abs(b)))) {
      return `${PLANE_NAMES[Math.floor(i / n)] ?? 'wall'}[${i % n}]: native ${a}, mirror ${b}`;
    }
  }
  return null;
}

describeNative('terrain parity — native C++ vs TS mirror', () => {
  let wasm: WatershedNativeModule;

  beforeAll(async () => {
    wasm = await loadNativeFromDisk();
  });

  it('exports the ABI 13 terrain entry points', () => {
    expect(wasm.getVersion()).toBeGreaterThanOrEqual(13);
  });

  it.each(TERRAIN_FIXTURES.map((f) => [f.name, f.params] as const))('golden fixture: %s', (_name, params) => {
    const native = buildTerrainTileNative(wasm, params);
    const mirror = buildTerrainTile(params);
    expect(native && mirror).toBeTruthy();
    expect(native!.planes.length).toBe(mirror!.vertexCount * TERRAIN_TILE_PLANES);
    expect(firstMismatch(native!.planes, mirror!.planes, mirror!.vertexCount)).toBeNull();
  });

  it('200 random segments (widths, grids, slot, tube, rock noise)', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const params = randomParams(seed);
      const native = buildTerrainTileNative(wasm, params);
      const mirror = buildTerrainTile(params);
      expect(native, `seed ${seed}`).not.toBeNull();
      const miss = firstMismatch(native!.planes, mirror!.planes, mirror!.vertexCount);
      expect(miss, `seed ${seed}`).toBeNull();
    }
  });

  it('the default channel (no samples) agrees', () => {
    const params = { ...TERRAIN_FIXTURES[0].params, channel: new Float32Array(0) };
    const native = buildTerrainTileNative(wasm, params)!;
    const mirror = buildTerrainTile(params)!;
    expect(firstMismatch(native.planes, mirror.planes, mirror.vertexCount)).toBeNull();
  });

  it.each(WALL_SHELL_FIXTURES.map((f) => [f.name, f.params] as const))('wall shell: %s', (_name, params: WallShellParams) => {
    const native = buildWallShellHeightsNative(wasm, params)!;
    const mirror = buildWallShellHeights(params)!;
    expect(firstMismatch(native, mirror, mirror.length)).toBeNull();
  });

  it('both backends reject a degenerate path', () => {
    const params = { ...TERRAIN_FIXTURES[0].params, pathLength: 0 };
    expect(buildTerrainTileNative(wasm, params)).toBeNull();
    expect(buildTerrainTile(params)).toBeNull();
  });
});
