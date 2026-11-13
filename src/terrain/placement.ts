/**
 * placement — a segment's props as one packed buffer (#487 D Phase B).
 *
 * A pure function of (tile, segment frame, layout spec, seed): the same bytes
 * on the main thread and on the sim worker (BUILD_TILE), exactly as the mesh
 * build. No three.js; the segment path is anything with `getPoint`.
 *
 * Every height is read from the segment's own tiles — the visual floor tile
 * (`buildCanyonTile`, the surface that is drawn) and, for the rim, the wall
 * shell (`buildWallShellTile`) — through `sampleTile`, in the tile datum
 * (metres above the row's path point). Nothing is ever placed in absolute
 * world Y. The frame is the one the meshes are built in: a vertex at path
 * parameter s and lateral x sits at `P(s) + (x, h, 0)`, P interpolated between
 * the tile's rows, so a prop at (s, x) is on the triangles that are drawn there.
 *
 * Lateral ranges are measured from the row's wetted bank edge (metres beyond
 * it, or bank units: 0 at the bank edge, 1 at the tile edge), never as
 * fractions of the canyon width. Each category draws from its own seeded
 * sub-stream, so a draw added to one never shifts another; a count cap is a
 * strict prefix of the uncapped list.
 *
 * This file is the entry and the step order (#559 C); the pieces live in
 * `placement/`: the wire format and reader (`format.ts`), the inputs
 * (`inputs.ts`), the record writer (`writer.ts`), the layout's working state
 * (`row.ts`), and one file per category family — authored set-pieces,
 * rocks, vegetation, atmosphere, fauna, glacial.
 */

import { fnv1a32 } from '../math/hash';
import { createRng, forkSeed } from '../math/random';
import { buildWallShellTile, TerrainProfile } from './terrainTile';
import { buildCanyonTile, type GeometryBuildContext } from './segmentMeshBuild';
import { emptyPlacements, PLACEMENT_CATEGORIES } from './placement/format';
import type { PlacementCaps, SegmentPlacementInput } from './placement/inputs';
import { PlacementWriter } from './placement/writer';
import { beginSegment, setRowSide, setRowStation, type PlacementRngs, type PlacementStep } from './placement/row';
import { placeAuthored } from './placement/authored';
import { placeDriftwood, placePebbles, placeRocks, placeSandBars } from './placement/rocks';
import {
  placeCanyonGrass,
  placeFerns,
  placeGrass,
  placeMushrooms,
  placeReeds,
  placeRimTrees,
  placeTrees,
  placeWildflowers,
} from './placement/vegetation';
import {
  placeFloatingLeaves,
  placeLeaves,
  placeMist,
  placeRapids,
  placeSunShafts,
  placeWaterLilies,
} from './placement/atmosphere';
import { placeBatRoost, placeBirds, placeDragonflies, placeFireflies, placeFish } from './placement/fauna';
import { placeIceSheets, placeIcicles } from './placement/glacial';

/** The segment's placement seed: per map, per segment (#522 C forks a daily seed off this). */
export function placementSeed(mapId: string, segmentId: number): number {
  return forkSeed(fnv1a32(mapId), `placement:${segmentId}`);
}

/**
 * The steps run at every (station, side), in the legacy order. Each draws
 * only from its own categories' streams; the order still matters where a step
 * reads another's count (birds / bats) or shares a stream (sand-bar pebbles).
 * They read the station / side from `placement/row.ts`.
 */
const ROW_STEPS: readonly PlacementStep[] = [
  placeRocks, //          1   rocks, scatterRocks, rockFoam
  placeTrees, //          2   trees, pinecones | cactus, desertSage
  placePebbles, //            pebbles
  placeSandBars, //       3.6 sandBars (+ pebbles)
  placeGrass, //          4   grass
  placeCanyonGrass, //    4.1 canyonGrass
  placeWildflowers, //    4.5 wildflowers
  placeFerns, //          4.6 ferns
  placeMushrooms, //      4.7 mushrooms
  placeReeds, //          5   reeds
  placeDriftwood, //      6   driftwood
  placeLeaves, //         7   leaves
  placeFloatingLeaves, // 7.5 floatingLeaves
  placeFireflies, //      8   fireflies
  placeBirds, //          9   birds (+ bats)
  placeFish, //           10  fish
  placeMist, //           11  mist
  placeWaterLilies, //    12  waterLilies
  placeSunShafts, //      13  sunShafts
  placeRapids, //         14  rapids
  placeDragonflies, //    15  dragonflies
  placeIcicles, //        16  icicles
  placeIceSheets, //      17  iceSheets
];

/**
 * Build a segment's placements. Pure: the same (ctx, input, caps) gives the
 * same bytes wherever it runs.
 */
export function buildSegmentPlacements(
  ctx: GeometryBuildContext,
  input: SegmentPlacementInput,
  caps?: PlacementCaps,
): ArrayBuffer {
  const pathLength = ctx.segmentPath.getLength();
  if (!Number.isFinite(pathLength) || pathLength <= 0) return emptyPlacements();
  const floor = buildCanyonTile(ctx, pathLength, 'visual');
  if (!floor) return emptyPlacements();
  const shellWidth = ctx.isSlotCanyon ? ctx.canyonWidth * 0.92 : ctx.canyonWidth * 1.5;
  const shellTile = buildWallShellTile({
    pathLength,
    shellWidth,
    segmentsX: 24,
    segmentsZ: Math.max(2, Math.floor(pathLength / 2)),
    profile: ctx.isSlotCanyon ? TerrainProfile.SLOT : TerrainProfile.OPEN,
    wallHeight: ctx.biomeProfile.wallHeight,
    segmentId: ctx.segmentId,
  });
  const w = new PlacementWriter(floor, shellTile, ctx.segmentPath, pathLength);
  const seed = placementSeed(input.mapId, ctx.segmentId);
  const rngs = Object.fromEntries(
    PLACEMENT_CATEGORIES.map((c) => [c, createRng(forkSeed(seed, c))]),
  ) as PlacementRngs;
  layoutSegment(w, ctx, input, rngs, pathLength);
  return w.pack(caps);
}

function layoutSegment(
  w: PlacementWriter,
  ctx: GeometryBuildContext,
  input: SegmentPlacementInput,
  R: PlacementRngs,
  len: number,
): void {
  beginSegment(ctx, input, len);

  // Authored overrides first (legacy order); the procedural pass skips their category.
  placeAuthored(w, ctx, R);

  const zSteps = Math.ceil(len / 2);
  for (let z = 0; z < zSteps; z += 1) {
    setRowStation(ctx, z / zSteps, zSteps);
    for (const side of [-1, 1]) {
      setRowSide(side);
      for (const step of ROW_STEPS) step(w, R);
    }
  }

  // Once per segment, after the walk.
  placeRimTrees(w, R);
  placeBatRoost(w, R);
}
