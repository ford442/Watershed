/**
 * PlacementWriter — the per-category record lists a segment's placement is
 * written into, and the packer that turns them into the buffer (#487 D; split
 * out of `terrain/placement.ts` in #559 C).
 *
 * Every height is read from the segment's own tiles through `sampleTile`, in
 * the tile datum (metres above the row's path point); a record's world
 * position is the path point interpolated between the tile's rows plus
 * (lateral, h, 0), so a prop at (s, x) is on the triangles that are drawn there.
 */

import { WATER_LEVEL } from '../../constants/game';
import { clamp01 } from '../../math/scalar';
import {
  bandBit,
  createTileSample,
  sampleTile,
  TerrainBand,
  type TerrainTile,
  type TileSample,
} from '../terrainTile';
import type { SegmentPath } from '../segmentMeshBuild';
import type { Vec3 } from '../meshMath';
import {
  CATEGORY_INDEX,
  PLACEMENT_CATEGORIES,
  PLACEMENT_HEADER_BYTES,
  PLACEMENT_HEADER_WORDS,
  PLACEMENT_MAGIC,
  PLACEMENT_STRIDE,
  PLACEMENT_VERSION,
  PlacementAnchor,
  type PlacementAnchorId,
  type PlacementCategory,
} from './format';
import type { PlacementCaps } from './inputs';

/** Bands a ground-snapped category may stand on. */
export const DRY = bandBit(TerrainBand.BANK) | bandBit(TerrainBand.WALL);
export const SHORE = bandBit(TerrainBand.FLOOR) | DRY;
export const BANK_ONLY = bandBit(TerrainBand.BANK);
export const ANY_GROUND = SHORE | bandBit(TerrainBand.RIM);

export class PlacementWriter {
  readonly lists: number[][] = PLACEMENT_CATEGORIES.map(() => []);
  readonly ground: TileSample = createTileSample();
  readonly shell: TileSample = createTileSample();
  private readonly rows: Float64Array;
  private readonly segmentsZ: number;
  private readonly cellZ: number;

  constructor(
    readonly floor: TerrainTile,
    readonly shellTile: TerrainTile | null,
    path: SegmentPath,
    readonly pathLength: number,
  ) {
    this.segmentsZ = floor.segmentsZ;
    this.cellZ = pathLength / floor.segmentsZ;
    this.rows = new Float64Array((floor.segmentsZ + 1) * 3);
    for (let iz = 0; iz <= floor.segmentsZ; iz += 1) {
      const p = path.getPoint(iz / floor.segmentsZ);
      const ok = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
      this.rows[iz * 3] = ok ? p.x : 0;
      this.rows[iz * 3 + 1] = ok ? p.y : 0;
      this.rows[iz * 3 + 2] = ok ? p.z : 0;
    }
  }

  /** Sample the floor at (s, lateral); true when on the tile, in `mask`, and (if asked) not under a fold. */
  onGround(s: number, lateral: number, mask: number, open = false): boolean {
    const g = sampleTile(this.floor, s, lateral, this.ground);
    return g.ok && (mask & bandBit(g.band)) !== 0 && !(open && g.covered);
  }

  /** Height of the ground at (s, lateral), or the water sheet where there is no tile (for air anchors). */
  groundOrWater(s: number, lateral: number): number {
    const g = sampleTile(this.floor, s, lateral, this.ground);
    return g.ok ? Math.max(g.y, WATER_LEVEL) : WATER_LEVEL;
  }

  /** Push a record whose ground sample is `sample` (already on `this.ground` / `this.shell`). */
  pushGround(
    category: PlacementCategory,
    s: number,
    lateral: number,
    sample: TileSample,
    embed: number,
    rx: number,
    ry: number,
    rz: number,
    sx: number,
    sy: number,
    sz: number,
    flags = 0,
  ): void {
    const r = clamp01(s) * this.segmentsZ;
    const iz0 = Math.min(this.segmentsZ - 1, Math.floor(r));
    const fz = r - iz0;
    const a = iz0 * 3;
    const b = a + 3;
    const rows = this.rows;
    const px = rows[a] + (rows[b] - rows[a]) * fz;
    const py = rows[a + 1] + (rows[b + 1] - rows[a + 1]) * fz;
    const pz = rows[a + 2] + (rows[b + 2] - rows[a + 2]) * fz;
    // World normal: along = dP/dz + (bx, by, 0), across = (ax, ay, 0).
    const bwx = (rows[b] - rows[a]) / this.cellZ + sample.bx;
    const bwy = (rows[b + 1] - rows[a + 1]) / this.cellZ + sample.by;
    const bwz = (rows[b + 2] - rows[a + 2]) / this.cellZ;
    let nx = -bwz * sample.ay;
    let ny = bwz * sample.ax;
    let nz = bwx * sample.ay - bwy * sample.ax;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    // Orient like the tile-frame normal (its z axis is the path direction).
    const dl = Math.hypot(bwx - sample.bx, bwy - sample.by, bwz) || 1;
    const ref =
      nx * (sample.nx + (sample.nz * (bwx - sample.bx)) / dl) +
      ny * (sample.ny + (sample.nz * (bwy - sample.by)) / dl) +
      nz * ((sample.nz * bwz) / dl);
    if (ref < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const aux = sample.band | (PlacementAnchor.GROUND << 3) | flags;
    this.lists[CATEGORY_INDEX[category]].push(
      px + lateral - nx * embed,
      py + sample.y - ny * embed,
      pz - nz * embed,
      nx,
      ny,
      nz,
      rx,
      ry,
      rz,
      sx,
      sy,
      sz,
      s,
      lateral,
      aux,
    );
  }

  /** Push a record at height `y` in the tile datum (water or air anchor), normal +Y. */
  pushAt(
    category: PlacementCategory,
    anchor: PlacementAnchorId,
    s: number,
    lateral: number,
    y: number,
    rx: number,
    ry: number,
    rz: number,
    sx: number,
    sy: number,
    sz: number,
    flags = 0,
  ): void {
    const r = clamp01(s) * this.segmentsZ;
    const iz0 = Math.min(this.segmentsZ - 1, Math.floor(r));
    const fz = r - iz0;
    const a = iz0 * 3;
    const b = a + 3;
    const rows = this.rows;
    const g = sampleTile(this.floor, s, lateral, this.ground);
    const band = g.ok ? g.band : TerrainBand.RIM;
    this.lists[CATEGORY_INDEX[category]].push(
      rows[a] + (rows[b] - rows[a]) * fz + lateral,
      rows[a + 1] + (rows[b + 1] - rows[a + 1]) * fz + y,
      rows[a + 2] + (rows[b + 2] - rows[a + 2]) * fz,
      0,
      1,
      0,
      rx,
      ry,
      rz,
      sx,
      sy,
      sz,
      s,
      lateral,
      band | (anchor << 3) | flags,
    );
  }

  /** Push a world-space record untouched (authored, `snap: false`). */
  pushWorld(category: PlacementCategory, s: number, lateral: number, p: Vec3, rx: number, ry: number, rz: number, sc: number, flags: number): void {
    this.lists[CATEGORY_INDEX[category]].push(
      p.x, p.y, p.z, 0, 1, 0, rx, ry, rz, sc, sc, sc, s, lateral,
      TerrainBand.RIM | (PlacementAnchor.AUTHORED << 3) | flags,
    );
  }

  count(category: PlacementCategory): number {
    return this.lists[CATEGORY_INDEX[category]].length / PLACEMENT_STRIDE;
  }

  truncate(category: PlacementCategory, n: number): void {
    const list = this.lists[CATEGORY_INDEX[category]];
    if (list.length > n * PLACEMENT_STRIDE) list.length = n * PLACEMENT_STRIDE;
  }

  pack(caps?: PlacementCaps): ArrayBuffer {
    const counts = PLACEMENT_CATEGORIES.map((c, k) => {
      const n = this.lists[k].length / PLACEMENT_STRIDE;
      const cap = caps?.[c];
      return cap === undefined ? n : Math.max(0, Math.min(n, Math.floor(cap)));
    });
    const total = counts.reduce((a, b) => a + b, 0);
    const buffer = new ArrayBuffer(PLACEMENT_HEADER_BYTES + total * PLACEMENT_STRIDE * 4);
    const header = new Uint32Array(buffer, 0, PLACEMENT_HEADER_WORDS);
    const records = new Float32Array(buffer, PLACEMENT_HEADER_BYTES, total * PLACEMENT_STRIDE);
    header[0] = PLACEMENT_MAGIC;
    header[1] = PLACEMENT_VERSION;
    header[2] = PLACEMENT_CATEGORIES.length;
    header[3] = PLACEMENT_STRIDE;
    let start = 0;
    counts.forEach((n, k) => {
      header[4 + 2 * k] = start;
      header[5 + 2 * k] = n;
      const list = this.lists[k];
      for (let i = 0; i < n * PLACEMENT_STRIDE; i += 1) records[start * PLACEMENT_STRIDE + i] = list[i];
      start += n;
    });
    return buffer;
  }
}
