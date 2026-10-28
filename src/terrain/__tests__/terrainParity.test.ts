/**
 * Terrain parity — a treadmill segment built in the sim worker (BUILD_TILE)
 * vs on the main thread (#487 Phase B).
 *
 * Since ABI 16 both run the same TypeScript (terrainTile.ts + segmentMeshBuild.ts;
 * the C++ tile was retired), so the four meshes and the SWE bed grid must be
 * the same floats and indices, bit for bit. This pins the worker wiring: the
 * spec survives structured clone, and the worker hands back exactly what the
 * main thread would have built.
 *
 * Opt-in like waterForceParity.test.ts: `pnpm test:wasm` (WATERSHED_WASM_INTEGRATION=1),
 * since the worker core is created on the real module.
 */

import type { WatershedNativeModule } from '../../systems/water/wasmAbi';
import { loadNativeFromDisk, nativePairOnDisk } from '../../testing/nativeFromDisk';
import { TERRAIN_CHANNEL_STRIDE, TerrainProfile } from '../terrainTile';
import { TERRAIN_FIXTURES } from './terrainFixtures';
import {
  buildSegmentMeshBuffers,
  contextFromSpec,
  type GeometryBuffers,
  type SegmentMeshSpec,
} from '../segmentMeshBuild';
import { createSimWorkerCore } from '../../sim/simWorkerCore';
import type { SimWorkerResponse } from '../../sim/simWorkerProtocol';

const runNative = process.env.WATERSHED_WASM_INTEGRATION === '1' && nativePairOnDisk();
const describeNative = runNative ? describe : describe.skip;

describeNative('worker-built segment meshes vs main thread', () => {
  let wasm: WatershedNativeModule;

  beforeAll(async () => {
    wasm = await loadNativeFromDisk();
  });

  function compare(label: string, worker: GeometryBuffers | null, main: GeometryBuffers | null) {
    expect(worker, label).not.toBeNull();
    expect(main, label).not.toBeNull();
    expect(Object.keys(worker!.attributes).sort(), label).toEqual(Object.keys(main!.attributes).sort());
    for (const [name, { array }] of Object.entries(main!.attributes)) {
      expect(worker!.attributes[name].array, `${label}.${name}`).toEqual(array);
    }
    expect(worker!.index, `${label}.index`).toEqual(main!.index);
  }

  it.each(TERRAIN_FIXTURES.map((f) => [f.name, f] as const))('BUILD_TILE is the main-thread build, bit for bit: %s', (_name, fixture) => {
    const spec = fixtureSegmentSpec(fixture);
    const responses: SimWorkerResponse[] = [];
    const core = createSimWorkerCore(wasm, (response) => responses.push(response));
    core.handle({ type: 'BUILD_TILE', seq: 3, spec: structuredClone(spec) });
    core.dispose();
    const tile = responses.find((r) => r.type === 'TILE');
    expect(tile).toMatchObject({ type: 'TILE', seq: 3 });
    const worker = tile?.type === 'TILE' ? tile.meshes : null;
    const main = buildSegmentMeshBuffers(contextFromSpec(spec));
    for (const key of ['canyon', 'collision', 'wallShell', 'water'] as const) {
      compare(key, worker?.[key] ?? null, main[key]);
    }
    // The SWE bed grid (#487 C): same hull tile, so the same floor heights.
    const wb = worker!.bed!;
    const mb = main.bed!;
    expect([wb.segmentsX, wb.segmentsZ, wb.width]).toEqual([mb.segmentsX, mb.segmentsZ, mb.width]);
    expect(wb.rows).toEqual(mb.rows);
    expect(wb.h).toEqual(mb.h);
  });
});

/** A curving segment of the fixture's length, with its channel unpacked back into samples. */
function fixtureSegmentSpec(fixture: (typeof TERRAIN_FIXTURES)[number]): SegmentMeshSpec {
  const p = fixture.params;
  const L = p.pathLength;
  const samples = p.channel.length / TERRAIN_CHANNEL_STRIDE;
  const channelProfile = Array.from({ length: samples }, (_, i) => {
    const o = i * TERRAIN_CHANNEL_STRIDE;
    const t = samples === 1 ? 0 : i / (samples - 1);
    return {
      t,
      worldArc: t,
      leftHalfWidth: p.channel[o],
      rightHalfWidth: p.channel[o + 1],
      corridorHalfWidth: p.channel[o + 2],
      floorDepth: p.channel[o + 3],
      floorWave: p.channel[o + 4],
      riffleStrength: p.channel[o + 5],
      gravelBarSide: (p.channel[o + 6] < 0 ? -1 : 1) as -1 | 1,
      undercutSide: (p.channel[o + 7] < 0 ? -1 : 1) as -1 | 1,
      flowScale: p.channel[o + 8],
    };
  });
  const slot = p.profile === TerrainProfile.SLOT;
  const biome = slot ? 'slotCanyon' : p.tube ? 'glacialMelt' : 'canyonSummer';
  return {
    segmentId: 11,
    path: {
      points: [0, -6, 0, 5, -8, -L / 3, -4, -10, (-2 * L) / 3, 2, -12, -L],
      closed: false,
      curveType: 'catmullrom',
      tension: 0.5,
    },
    canyonWidth: p.canyonWidth,
    waterWidth: p.waterWidth,
    biome,
    channelProfile,
    isSlotCanyon: slot,
    isGlacier: Boolean(p.tube),
    biomeProfile: { id: biome as SegmentMeshSpec['biomeProfile']['id'], wallHeight: slot ? 26 : 15 },
    tubeProfile: p.tube ? { ...p.tube } : null,
  };
}
