/**
 * Placement parity and surface contract (#487 D Phase B).
 *
 * Every registered map is walked through ChunkManager exactly as the runtime
 * does; each segment is built into a GeometryBuildContext the way TrackSegment
 * builds it, and its placements are checked:
 *
 *   - parity: the worker path (spec → structured clone → contextFromSpec, the
 *     CatmullRomPath port) and the main thread (THREE.CatmullRomCurve3) give
 *     the same bytes, for the first 12 segments and one late one per map;
 *   - determinism: same (map, segment) → same bytes; another map → other bytes;
 *   - surface: a snapped instance's anchor is within 0.15 m of the tile
 *     surface along the local normal, and not off it sideways;
 *   - no trees / rim trees on a tube crown or under a fold.
 */

import { describe, expect, it } from 'vitest';
import { ChunkManager } from '../../systems/map/ChunkManager';
import { DEFAULT_MAP_CONFIG, ProceduralMapManager } from '../../systems/map/MapSystem';
import type { SegmentData } from '../../systems/map/ChunkManager';
import { getMapDefinition, mapRegistryIds, type MapRegistryId } from '../../maps/registry';
import { getTrackBiomeProfile, isGlacialBiome } from '../../configs/TrackBiomes';
import { normalizeBiomeId } from '../../configs/biomes';
import { resolveTubeProfile } from '../../components/TrackSegment/hooks/geometryBuilders';
import { buildChannelProfile } from '../../components/TrackSegment/channelProfile';
import { placementInputFor } from '../../components/TrackSegment/hooks/usePlacementData';
import { createSimWorkerCore } from '../../sim/simWorkerCore';
import type { SimWorkerResponse } from '../../sim/simWorkerProtocol';
import type { WatershedNativeModule } from '../../systems/water/wasmAbi';
import {
  buildCanyonTile,
  buildSegmentMeshBuffers,
  contextFromSpec,
  segmentMeshSpec,
  type GeometryBuildContext,
} from '../segmentMeshBuild';
import { buildSegmentPlacements } from '../placement';
import {
  auxAnchor,
  auxBand,
  categoryRange,
  PLACEMENT_CATEGORIES,
  PLACEMENT_STRIDE,
  PlacementAnchor,
  PlacementField as F,
  readPlacements,
  type PlacementCategory,
} from '../placement/format';
import type { SegmentPlacementInput } from '../placement/inputs';
import { createTileSample, sampleTile, TerrainBand, TileBranch } from '../terrainTile';

interface BuiltSegment {
  mapId: MapRegistryId;
  segment: SegmentData;
  ctx: GeometryBuildContext;
  input: SegmentPlacementInput;
}

/** The context TrackSegment builds for `segment` (index.tsx + useGeometries + usePlacementInput). */
function contextFor(mapId: MapRegistryId, segment: SegmentData): BuiltSegment {
  const biome = normalizeBiomeId(segment.biome);
  const biomeProfile = getTrackBiomeProfile(biome);
  const isSlotCanyon = biomeProfile.id === 'slotCanyon';
  const canyonWidth = isSlotCanyon ? biomeProfile.canyonWidth : segment.width ?? 28;
  const waterWidth =
    segment.waterWidth ?? (segment.type === 'pond' ? Math.max(45, biomeProfile.waterWidth) : biomeProfile.waterWidth);
  const isGlacier = isGlacialBiome(biome, biomeProfile);
  const pathLength = segment.segmentPath.getLength();
  const ctx: GeometryBuildContext = {
    segmentPath: segment.segmentPath,
    segmentId: segment.id,
    canyonWidth,
    waterWidth,
    biome,
    channelProfile: buildChannelProfile({ segmentId: segment.id, pathLength, waterWidth, segmentType: segment.type, isSlotCanyon }),
    isSlotCanyon,
    isGlacier,
    biomeProfile,
    tubeProfile: resolveTubeProfile({ isGlacier, biome, type: segment.type, canyonWidth }),
  };
  const input = {
    ...placementInputFor({ type: segment.type, biome, biomeProfile, config: segment.config, flowSpeed: segment.flowSpeed ?? 1 }),
    mapId,
  };
  return { mapId, segment, ctx: { ...ctx, placement: input }, input };
}

const LATE_INDEX = 20;

/** First 12 segments of the map's treadmill and one at index ≥ 20. */
function walkMap(mapId: MapRegistryId): BuiltSegment[] {
  const def = getMapDefinition(mapId);
  const manager = new ProceduralMapManager(def.levelData, def.fallbackProgression, {}, def.continuation ?? null);
  const chunks = new ChunkManager({ mapManager: manager, startIndex: def.startIndex, proceduralBaseSeed: DEFAULT_MAP_CONFIG.seed });
  chunks.initializePool();
  const seen = new Map<number, SegmentData>();
  const record = () => chunks.getActiveSegments().forEach((s) => seen.has(s.id) || seen.set(s.id, s));
  record();
  let cursor = def.startIndex;
  for (let step = 0; step < 200 && !(seen.size >= 12 && [...seen.keys()].some((k) => k >= LATE_INDEX)); step += 1) {
    const active = chunks.getActiveSegments();
    const segment = active.find((s) => s.id === cursor) ?? active.at(-1)!;
    chunks.update(segment.segmentPath.getPoint(0.5).z);
    record();
    cursor += 1;
  }
  chunks.dispose();
  const ids = [...seen.keys()].sort((a, b) => a - b);
  const pick = [...ids.slice(0, 12), ids.find((id) => id >= LATE_INDEX)].filter((id): id is number => id !== undefined);
  return pick.map((id) => contextFor(mapId, seen.get(id)!));
}

const MAPS = mapRegistryIds();
const WALKS = new Map(MAPS.map((id) => [id, walkMap(id)]));
/** Byte identity without a deep-equal walk over 100 kB arrays. */
const same = (a: ArrayBuffer, b: ArrayBuffer) => Buffer.from(a).equals(Buffer.from(b));

describe('placement buffer — parity and determinism', () => {
  it.each(MAPS)('%s: the worker path builds the main-thread bytes', (mapId) => {
    const walk = WALKS.get(mapId)!;
    expect(walk.length).toBeGreaterThanOrEqual(13);
    expect(walk.at(-1)!.segment.id).toBeGreaterThanOrEqual(LATE_INDEX);
    for (const { ctx, input, segment } of walk) {
      const main = buildSegmentPlacements(ctx, input);
      const spec = structuredClone(segmentMeshSpec(ctx));
      const worker = buildSegmentPlacements(contextFromSpec(spec), spec.placement!);
      expect(same(worker, main), `${mapId} seg ${segment.id}`).toBe(true);
      expect(same(buildSegmentPlacements(ctx, input), main), `${mapId} seg ${segment.id} rerun`).toBe(true);
    }
  });

  it('the seed is per map: another map id, same segment → other bytes', () => {
    const { ctx, input } = WALKS.get(MAPS[0])![3];
    const a = buildSegmentPlacements(ctx, input);
    const b = buildSegmentPlacements(ctx, { ...input, mapId: `${input.mapId}-other` });
    expect(same(a, b)).toBe(false);
  });

  it('every map places something on most segments', () => {
    for (const mapId of MAPS) {
      const total = WALKS.get(mapId)!.reduce(
        (n, { ctx, input }) => n + (buildSegmentPlacements(ctx, input).byteLength > 400 ? 1 : 0),
        0,
      );
      expect(total, mapId).toBeGreaterThan(8);
    }
  });
});

describe('placement buffer — surface contract', () => {
  it('snapped instances sit on the tile within 0.15 m along the local normal', () => {
    const maxDev: Partial<Record<PlacementCategory, number>> = {};
    const counts: Partial<Record<PlacementCategory, number>> = {};
    const sample = createTileSample();
    for (const walk of WALKS.values()) {
      for (const { ctx, input, segment } of walk) {
        const view = readPlacements(buildSegmentPlacements(ctx, input))!;
        const len = ctx.segmentPath.getLength();
        const tile = buildCanyonTile(ctx, len, 'visual')!;
        const rows = Array.from({ length: tile.segmentsZ + 1 }, (_, iz) => ctx.segmentPath.getPoint(iz / tile.segmentsZ));
        for (const category of PLACEMENT_CATEGORIES) {
          const { start, count } = categoryRange(view, category);
          for (let i = 0; i < count; i += 1) {
            const o = (start + i) * PLACEMENT_STRIDE;
            const r = view.records;
            const aux = r[o + F.AUX];
            if (auxAnchor(aux) !== PlacementAnchor.GROUND) continue;
            const s = r[o + F.S];
            const lat = r[o + F.LATERAL];
            const branch = auxBand(aux) === TerrainBand.CROWN ? TileBranch.CROWN : TileBranch.FLOOR;
            if (!sampleTile(tile, s, lat, sample, branch).ok) continue; // rim instance on the wall shell
            if (category === 'rimTrees' && Math.abs(lat) > Math.abs(tile.x[0])) continue;
            const q = Math.min(1, Math.max(0, s)) * tile.segmentsZ;
            const iz0 = Math.min(tile.segmentsZ - 1, Math.floor(q));
            const fz = q - iz0;
            const P0 = rows[iz0];
            const P1 = rows[iz0 + 1];
            const tx = P0.x + (P1.x - P0.x) * fz + lat;
            const ty = P0.y + (P1.y - P0.y) * fz + sample.y;
            const tz = P0.z + (P1.z - P0.z) * fz;
            const dx = r[o + F.PX] - tx;
            const dy = r[o + F.PY] - ty;
            const dz = r[o + F.PZ] - tz;
            const along = dx * r[o + F.NX] + dy * r[o + F.NY] + dz * r[o + F.NZ];
            const off = Math.hypot(dx - along * r[o + F.NX], dy - along * r[o + F.NY], dz - along * r[o + F.NZ]);
            // float32 world coordinates hundreds of metres down: ~1e-4 m of rounding.
            expect(Math.abs(along), `${category} seg ${segment.id}`).toBeLessThanOrEqual(0.15 + 1e-3);
            expect(off, `${category} seg ${segment.id} sideways`).toBeLessThanOrEqual(1e-3);
            maxDev[category] = Math.max(maxDev[category] ?? 0, Math.abs(along));
            counts[category] = (counts[category] ?? 0) + 1;
          }
        }
      }
    }
    // The per-category table the PR carries.
    const table = Object.keys(counts)
      .map((c) => `${c}\t${counts[c as PlacementCategory]}\t${maxDev[c as PlacementCategory]!.toFixed(4)}`)
      .join('\n');
    if (process.env.PLACEMENT_TABLE === '1') console.log(`category\tinstances\tmax |Δ·n| (m)\n${table}`);
    expect(Object.keys(counts).length).toBeGreaterThan(8);
  });

  it('no trees or rim trees on a crown or under a fold', () => {
    for (const walk of WALKS.values()) {
      for (const { ctx, input } of walk) {
        const view = readPlacements(buildSegmentPlacements(ctx, input))!;
        const tile = buildCanyonTile(ctx, ctx.segmentPath.getLength(), 'visual')!;
        const sample = createTileSample();
        for (const category of ['trees', 'rimTrees'] as const) {
          const { start, count } = categoryRange(view, category);
          for (let i = 0; i < count; i += 1) {
            const o = (start + i) * PLACEMENT_STRIDE;
            expect(auxBand(view.records[o + F.AUX])).not.toBe(TerrainBand.CROWN);
            if (sampleTile(tile, view.records[o + F.S], view.records[o + F.LATERAL], sample).ok) {
              expect(sample.covered).toBe(false);
            }
          }
        }
      }
    }
  });
});

describe('placement buffer — caps and overrides', () => {
  it('a capped layout is a strict prefix of the full one', () => {
    const { ctx, input } = WALKS.get(MAPS[0])![2];
    const full = readPlacements(buildSegmentPlacements(ctx, input))!;
    const caps = { rocks: 1, pebbles: 3, trees: 2, mist: 0 } as const;
    const capped = readPlacements(buildSegmentPlacements(ctx, input, caps))!;
    for (const category of PLACEMENT_CATEGORIES) {
      const a = categoryRange(full, category);
      const b = categoryRange(capped, category);
      const cap = (caps as Partial<Record<PlacementCategory, number>>)[category];
      expect(b.count).toBe(cap === undefined ? a.count : Math.min(cap, a.count));
      const fa = full.records.subarray(a.start * PLACEMENT_STRIDE, (a.start + b.count) * PLACEMENT_STRIDE);
      const fb = capped.records.subarray(b.start * PLACEMENT_STRIDE, (b.start + b.count) * PLACEMENT_STRIDE);
      expect(fb).toEqual(fa);
    }
  });

  it('a rigid vertical translation of the segment moves every instance by exactly that', () => {
    const { ctx, input } = WALKS.get(MAPS[0])![4];
    const lifted: GeometryBuildContext = {
      ...ctx,
      segmentPath: {
        ...ctx.segmentPath,
        points: ctx.segmentPath.points,
        closed: ctx.segmentPath.closed,
        curveType: ctx.segmentPath.curveType,
        tension: ctx.segmentPath.tension,
        getLength: () => ctx.segmentPath.getLength(),
        getPoint: (t: number) => {
          const p = ctx.segmentPath.getPoint(t);
          return { x: p.x, y: p.y + 40, z: p.z };
        },
      },
    };
    const a = readPlacements(buildSegmentPlacements(ctx, input))!.records;
    const b = readPlacements(buildSegmentPlacements(lifted, input))!.records;
    expect(b.length).toBe(a.length);
    for (let o = 0; o < a.length; o += PLACEMENT_STRIDE) {
      expect(b[o + F.PY] - a[o + F.PY]).toBeCloseTo(40, 3);
      expect(b[o + F.PX]).toBe(a[o + F.PX]);
      expect(b[o + F.NY]).toBeCloseTo(a[o + F.NY], 5);
    }
  });

  it('snap: false keeps the legacy position of the seg-14 launch slab', () => {
    const def = getMapDefinition('meander');
    const manager = new ProceduralMapManager(def.levelData, def.fallbackProgression, {}, def.continuation ?? null);
    const rocks = manager.getChunkConfig(14).decorations?.rocks;
    expect(Array.isArray(rocks)).toBe(true);
    const slab = (rocks as { snap?: boolean; localX: number; localZ: number }[])[0];
    expect(slab.snap).toBe(false);

    const { ctx, input } = WALKS.get(MAPS[0])![5];
    const authored = { ...input, rocks: [{ ...slab }] };
    const view = readPlacements(buildSegmentPlacements(ctx, authored))!;
    const { start, count } = categoryRange(view, 'rocks');
    expect(count).toBe(1);
    const o = start * PLACEMENT_STRIDE;
    expect(auxAnchor(view.records[o + F.AUX])).toBe(PlacementAnchor.AUTHORED);
    // Legacy: path point + binormal · localX, raised by the guessed open-canyon height.
    const len = ctx.segmentPath.getLength();
    const t = Math.max(0, Math.min(1, 0.5 + slab.localZ / len));
    const p = ctx.segmentPath.getPoint(t);
    const p1 = ctx.segmentPath.getPoint(Math.max(0, t - 1e-4));
    const p2 = ctx.segmentPath.getPoint(Math.min(1, t + 1e-4));
    const tl = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
    const bx = -(p2.z - p1.z) / tl;
    const bz = (p2.x - p1.x) / tl;
    const bl = Math.hypot(bx, bz);
    const nd = Math.abs(slab.localX) / (ctx.canyonWidth * 0.45);
    let yH = nd ** 2.5 * 12;
    if (Math.abs(slab.localX) < ctx.waterWidth / 2 + 2) yH *= 0.1;
    expect(view.records[o + F.PX]).toBeCloseTo(p.x + (bx / bl) * slab.localX, 3);
    expect(view.records[o + F.PY]).toBeCloseTo(p.y + yH, 3);
    expect(view.records[o + F.PZ]).toBeCloseTo(p.z + (bz / bl) * slab.localX, 3);

    // The same slab snapped stands on the tile instead.
    const snapped = readPlacements(buildSegmentPlacements(ctx, { ...input, rocks: [{ ...slab, snap: true }] }))!;
    const so = categoryRange(snapped, 'rocks').start * PLACEMENT_STRIDE;
    expect(auxAnchor(snapped.records[so + F.AUX])).toBe(PlacementAnchor.GROUND);
  });
});

describe('BUILD_TILE carries the placements', () => {
  it('the worker core builds them with the meshes, transfers the one buffer, and matches the main thread', () => {
    const { ctx, input } = WALKS.get(MAPS[0])![6];
    const responses: { response: SimWorkerResponse; transfer?: Transferable[] }[] = [];
    // BUILD_TILE never touches the native module.
    const core = createSimWorkerCore({} as WatershedNativeModule, (response, transfer) => responses.push({ response, transfer }));
    core.handle({ type: 'BUILD_TILE', seq: 9, spec: structuredClone(segmentMeshSpec(ctx)) });
    core.dispose();
    const tile = responses.find((r) => r.response.type === 'TILE')!;
    expect(tile.response.type).toBe('TILE');
    if (tile.response.type !== 'TILE') return;
    const placements = tile.response.placements!;
    expect(placements).toBeInstanceOf(ArrayBuffer);
    expect(tile.transfer).toContain(placements);
    expect(same(placements, buildSegmentPlacements(ctx, input))).toBe(true);
    // Transferred, not cloned: posting it detaches the sender's copy.
    const posted = structuredClone(placements, { transfer: [placements] });
    expect(placements.byteLength).toBe(0);
    expect(posted.byteLength).toBeGreaterThan(0);
    // The meshes are unchanged by the ride-along.
    expect(tile.response.meshes?.canyon?.attributes.position.array).toEqual(
      buildSegmentMeshBuffers(ctx).canyon?.attributes.position.array,
    );
  });

  it('a spec without placement input asks for none', () => {
    const { ctx } = WALKS.get(MAPS[0])![0];
    const responses: SimWorkerResponse[] = [];
    const core = createSimWorkerCore({} as WatershedNativeModule, (response) => responses.push(response));
    core.handle({ type: 'BUILD_TILE', seq: 1, spec: segmentMeshSpec({ ...ctx, placement: null }) });
    core.dispose();
    const tile = responses.find((r) => r.type === 'TILE');
    expect(tile?.type === 'TILE' ? tile.placements : 'missing').toBeNull();
  });
});
