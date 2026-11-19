/**
 * Authored set-pieces: a map's own rocks and trees (`decorations`), snapped to
 * the tile (#487 D; split out of `terrain/placement.ts` in #559 C). They are
 * placed before the procedural pass, which then skips their category.
 */

import { clamp01 } from '../../math/scalar';
import type { Rng } from '../../math/random';
import { sampleTile } from '../terrainTile';
import type { GeometryBuildContext } from '../segmentMeshBuild';
import { PlacementAnchor, PlacementAux, ROCK_TYPE_CODES } from './format';
import type { PlacementOverride } from './inputs';
import { pathTangent } from './frame';
import { bankStart, input, type PlacementRngs } from './row';
import { ANY_GROUND, type PlacementWriter } from './writer';

const rockTypeFlag = (rockType: string | undefined): number => {
  const code = (ROCK_TYPE_CODES as readonly string[]).indexOf(rockType ?? 'auto');
  return (code > 0 ? code : 0) << PlacementAux.ROCK_TYPE_SHIFT;
};

/** The legacy guessed height of an authored decoration (open-canyon curve), for `snap: false`. */
function legacyAuthoredY(kind: 'rocks' | 'trees', localX: number, localZ: number, canyonWidth: number, bankStart: number): number {
  const normalizedDist = Math.abs(localX) / (canyonWidth * 0.45);
  let yH = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
  if (kind === 'trees') {
    yH += Math.sin(localZ * 0.15) * Math.cos(localX * 0.3) * 1.5;
    if (yH > 25) yH = 25;
    return yH - 0.5;
  }
  if (Math.abs(localX) < bankStart + 2) yH *= 0.1;
  return yH;
}

/**
 * Snap one authored decoration: height and normal from the tile, `localX` /
 * `localZ` untouched (they are the tile's lateral and the offset from the
 * segment's middle). `snap: false` keeps the legacy position — the path point
 * plus the binormal times `localX`, at the guessed open-canyon height — so a
 * set-piece whose collider height is tuned (the seg-14 launch slab) does not
 * move. Returns false when nothing could be placed.
 */
function snapOverride(
  writer: PlacementWriter,
  ctx: GeometryBuildContext,
  category: 'rocks' | 'trees',
  override: PlacementOverride,
  rng: Rng,
  flags: number,
): boolean {
  const len = writer.pathLength;
  const { localX, localZ } = override;
  if (!Number.isFinite(localX) || !Number.isFinite(localZ)) return false;
  const s = clamp01(0.5 + localZ / len);
  const scale = override.scale ?? (category === 'trees' ? 2.0 : 1.0);
  let rx = 0;
  let ry = override.rotation ?? 0;
  let rz = 0;
  if (category === 'rocks' && override.rotation == null) {
    rx = rng() * Math.PI;
    ry = rng() * Math.PI;
    rz = rng() * Math.PI;
  }
  const authored = flags | PlacementAux.AUTHORED;

  if (override.snap === false) {
    const pp = ctx.segmentPath.getPoint(s);
    const tang = pathTangent(ctx.segmentPath, s);
    // binormal = tangent × up, normalised (three's crossVectors + normalize).
    const bl = Math.hypot(-tang.z, 0, tang.x) || 1;
    const bx = -tang.z / bl;
    const bz = tang.x / bl;
    const y = legacyAuthoredY(category, localX, localZ, ctx.canyonWidth, ctx.waterWidth / 2);
    writer.pushWorld(category, s, localX, { x: pp.x + bx * localX, y: pp.y + y, z: pp.z + bz * localX }, rx, ry, rz, scale, authored);
    return true;
  }

  const embed = category === 'trees' ? 0.1 : 0;
  if (writer.onGround(s, localX, ANY_GROUND)) {
    writer.pushGround(category, s, localX, writer.ground, embed, rx, ry, rz, scale, scale, scale, authored);
    return true;
  }
  // Off the floor tile (wider than the canyon): stand on the wall shell.
  if (writer.shellTile && sampleTile(writer.shellTile, s, localX, writer.shell).ok) {
    writer.pushGround(category, s, localX, writer.shell, embed, rx, ry, rz, scale, scale, scale, authored);
    return true;
  }
  const y = legacyAuthoredY(category, localX, localZ, ctx.canyonWidth, ctx.waterWidth / 2);
  writer.pushAt(category, PlacementAnchor.AIR, s, localX, y, rx, ry, rz, scale, scale, scale, authored);
  return true;
}

/** Authored overrides, trees then rocks (legacy order); the procedural pass skips their category. */
export function placeAuthored(w: PlacementWriter, ctx: GeometryBuildContext, R: PlacementRngs): void {
  if (input.trees) for (const o of input.trees) snapOverride(w, ctx, 'trees', o, R.trees, 0);
  if (input.rocks) {
    for (const o of input.rocks) {
      const near = Math.abs(o.localX) > bankStart + 3 ? PlacementAux.NEAR_WALL : 0;
      snapOverride(w, ctx, 'rocks', o, R.rocks, near | rockTypeFlag(o.rockType));
    }
  }
}
