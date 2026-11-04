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
 * Buffer layout (one ArrayBuffer, `PLACEMENT_HEADER_BYTES` of Uint32 header,
 * then Float32 records):
 *
 *   header  [MAGIC, VERSION, categoryCount, stride, (start, count) × categories]
 *   record  px py pz | nx ny nz | rx ry rz | sx sy sz | s lateral | aux
 *
 * p is world position (the instance anchor, sunk `embed` metres along n),
 * n the world normal of the surface it stands on (+Y off the ground), r an
 * XYZ Euler, s/lateral the tile coordinates it was placed at, and aux packs
 * the band, the anchor kind and per-category flags (`PlacementAux`).
 */

import { WATER_LEVEL } from '../constants/game';
import { fnv1a32 } from '../math/hash';
import { clamp01 } from '../math/scalar';
import { createRng, forkSeed, type Rng } from '../math/random';
import type { ChannelShape } from './types';
import {
  bandBit,
  buildWallShellTile,
  createTileSample,
  sampleChannelShape,
  sampleTile,
  TerrainBand,
  TerrainProfile,
  TileBranch,
  type TerrainBandId,
  type TerrainTile,
  type TileSample,
} from './terrainTile';
import { buildCanyonTile, type GeometryBuildContext, type SegmentPath } from './segmentMeshBuild';
import type { Vec3 } from './meshMath';

// ---------------------------------------------------------------------------
// Categories and the wire layout
// ---------------------------------------------------------------------------

/** The 31 placement categories, in `PlacementData` key order. */
export const PLACEMENT_CATEGORIES = [
  'rocks',
  'scatterRocks',
  'trees',
  'cactus',
  'desertSage',
  'grass',
  'canyonGrass',
  'wildflowers',
  'reeds',
  'driftwood',
  'leaves',
  'floatingLeaves',
  'fireflies',
  'birds',
  'bats',
  'fish',
  'pebbles',
  'sandBars',
  'mist',
  'waterLilies',
  'sunShafts',
  'ferns',
  'rapids',
  'dragonflies',
  'pinecones',
  'mushrooms',
  'rimTrees',
  'rockFoam',
  'canyonDust',
  'icicles',
  'iceSheets',
] as const;
export type PlacementCategory = (typeof PLACEMENT_CATEGORIES)[number];

const CATEGORY_INDEX: Readonly<Record<PlacementCategory, number>> = Object.fromEntries(
  PLACEMENT_CATEGORIES.map((c, i) => [c, i]),
) as Record<PlacementCategory, number>;

export const PLACEMENT_MAGIC = 0x57504c31; // 'WPL1'
export const PLACEMENT_VERSION = 1;
/** Floats per instance record. */
export const PLACEMENT_STRIDE = 15;
export const PLACEMENT_HEADER_WORDS = 4 + 2 * PLACEMENT_CATEGORIES.length;
export const PLACEMENT_HEADER_BYTES = PLACEMENT_HEADER_WORDS * 4;

/** Record field offsets. */
export const PlacementField = {
  PX: 0,
  PY: 1,
  PZ: 2,
  NX: 3,
  NY: 4,
  NZ: 5,
  RX: 6,
  RY: 7,
  RZ: 8,
  SX: 9,
  SY: 10,
  SZ: 11,
  S: 12,
  LATERAL: 13,
  AUX: 14,
} as const;

/** How an instance's height was set. */
export const PlacementAnchor = {
  /** On the tile surface (snapped), sunk `embed` ≤ 0.15 m along the normal. */
  GROUND: 0,
  /** On or under the water sheet (path point + WATER_LEVEL + offset). */
  WATER: 1,
  /** In the air, above max(ground, water). */
  AIR: 2,
  /** Authored with `snap: false`: the legacy position, untouched. */
  AUTHORED: 3,
} as const;
export type PlacementAnchorId = (typeof PlacementAnchor)[keyof typeof PlacementAnchor];

/**
 * aux bit layout (an integer < 2^24, exact in float32):
 *   bits 0–2 band · bits 3–4 anchor · bit 5 nearWall · bit 6 authored ·
 *   bits 7–8 rock type (0 auto, 1 boulder, 2 slab, 3 column) · bit 9 mist column
 */
export const PlacementAux = {
  NEAR_WALL: 1 << 5,
  AUTHORED: 1 << 6,
  ROCK_TYPE_SHIFT: 7,
  MIST_COLUMN: 1 << 9,
} as const;

export const ROCK_TYPE_CODES = ['auto', 'boulder', 'slab', 'column'] as const;

export const auxBand = (aux: number): TerrainBandId => (aux & 7) as TerrainBandId;
export const auxAnchor = (aux: number): PlacementAnchorId => ((aux >> 3) & 3) as PlacementAnchorId;
export const auxRockType = (aux: number): (typeof ROCK_TYPE_CODES)[number] =>
  ROCK_TYPE_CODES[(aux >> PlacementAux.ROCK_TYPE_SHIFT) & 3];

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Everything placement reads about the segment beyond its geometry: biome
 * flags and densities resolved by the caller (the module never imports biome
 * tables). Plain data, so it crosses to the sim worker.
 */
export interface PropLayoutSpec {
  segmentType: string;
  isSlotCanyon: boolean;
  isGlacier: boolean;
  isAutumnLike: boolean;
  isSummerLike: boolean;
  isLumberFlume: boolean;
  flowSpeed: number;
  wallHeight: number;
  lodQuality: string;
  particleCount: number;
  rockDensity: string;
  treeDensity: number;
}

/** An authored decoration (`DecorationPlacement` plus `snap`). */
export interface PlacementOverride {
  localX: number;
  localZ: number;
  scale?: number;
  rotation?: number;
  rockType?: string;
  /** Height and normal from the tile (default). `false` keeps the legacy guessed height and binormal frame. */
  snap?: boolean;
}

/** What crosses to the worker with the mesh spec. */
export interface SegmentPlacementInput {
  mapId: string;
  layout: PropLayoutSpec;
  /** Authored rocks / trees for the segment; null = procedural. */
  rocks: PlacementOverride[] | null;
  trees: PlacementOverride[] | null;
}

/** Per-category count caps; each is a strict prefix of the uncapped list. */
export type PlacementCaps = Partial<Record<PlacementCategory, number>>;

/** The segment's placement seed: per map, per segment (#522 C forks a daily seed off this). */
export function placementSeed(mapId: string, segmentId: number): number {
  return forkSeed(fnv1a32(mapId), `placement:${segmentId}`);
}

// ---------------------------------------------------------------------------
// Reading a buffer
// ---------------------------------------------------------------------------

export interface PlacementView {
  header: Uint32Array;
  records: Float32Array;
}

/** Views over a placement buffer, or null when it is not one. */
export function readPlacements(buffer: ArrayBuffer | null | undefined): PlacementView | null {
  if (!buffer || buffer.byteLength < PLACEMENT_HEADER_BYTES) return null;
  const header = new Uint32Array(buffer, 0, PLACEMENT_HEADER_WORDS);
  if (header[0] !== PLACEMENT_MAGIC || header[1] !== PLACEMENT_VERSION) return null;
  if (header[2] !== PLACEMENT_CATEGORIES.length || header[3] !== PLACEMENT_STRIDE) return null;
  const floats = (buffer.byteLength - PLACEMENT_HEADER_BYTES) / 4;
  return { header, records: new Float32Array(buffer, PLACEMENT_HEADER_BYTES, floats) };
}

/** First record index and record count of `category`. */
export function categoryRange(view: PlacementView, category: PlacementCategory): { start: number; count: number } {
  const k = CATEGORY_INDEX[category];
  return { start: view.header[4 + 2 * k], count: view.header[5 + 2 * k] };
}

/** The records of one category (a subarray, no copy). */
export function categoryRecords(view: PlacementView, category: PlacementCategory): Float32Array {
  const { start, count } = categoryRange(view, category);
  return view.records.subarray(start * PLACEMENT_STRIDE, (start + count) * PLACEMENT_STRIDE);
}

// ---------------------------------------------------------------------------
// Frame helpers (three-free ports)
// ---------------------------------------------------------------------------

/** three's Curve.getTangent: a ±1e-4 central difference, normalised. */
export function pathTangent(path: Pick<SegmentPath, 'getPoint'>, t: number): Vec3 {
  const delta = 0.0001;
  const p1 = path.getPoint(Math.max(0, t - delta));
  const p2 = path.getPoint(Math.min(1, t + delta));
  const x = p2.x - p1.x;
  const y = p2.y - p1.y;
  const z = p2.z - p1.z;
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

/** XYZ Euler of the rotation taking +Y onto `to` (three's setFromUnitVectors → setFromQuaternion). */
function eulerFromUp(to: Vec3): Vec3 {
  // q = (up × to, 1 + up·to), normalised.
  let qx = to.z;
  let qy = 0;
  let qz = -to.x;
  let qw = 1 + to.y;
  const ql = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= ql;
  qy /= ql;
  qz /= ql;
  qw /= ql;
  const m11 = 1 - 2 * (qy * qy + qz * qz);
  const m12 = 2 * (qx * qy - qw * qz);
  const m13 = 2 * (qx * qz + qw * qy);
  const m22 = 1 - 2 * (qx * qx + qz * qz);
  const m23 = 2 * (qy * qz - qw * qx);
  const m32 = 2 * (qy * qz + qw * qx);
  const m33 = 1 - 2 * (qx * qx + qy * qy);
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return { x: Math.atan2(-m23, m33), y, z: Math.atan2(-m12, m11) };
  return { x: Math.atan2(m32, m22), y, z: 0 };
}

const unit = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};
const SLOT_SHAFT_ROTATION = eulerFromUp(unit(0.1, 1, 0.05));
const OPEN_SHAFT_ROTATION = eulerFromUp(unit(10, 20, 5));

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/** Bands a ground-snapped category may stand on. */
const DRY = bandBit(TerrainBand.BANK) | bandBit(TerrainBand.WALL);
const SHORE = bandBit(TerrainBand.FLOOR) | DRY;
const BANK_ONLY = bandBit(TerrainBand.BANK);
const ANY_GROUND = SHORE | bandBit(TerrainBand.RIM);

class PlacementWriter {
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

/** An empty, valid placement buffer. */
export function emptyPlacements(): ArrayBuffer {
  const buffer = new ArrayBuffer(PLACEMENT_HEADER_BYTES);
  const header = new Uint32Array(buffer);
  header[0] = PLACEMENT_MAGIC;
  header[1] = PLACEMENT_VERSION;
  header[2] = PLACEMENT_CATEGORIES.length;
  header[3] = PLACEMENT_STRIDE;
  return buffer;
}

const ROCK_CHANCE: Record<string, number> = { low: 0.4, high: 0.7 };

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
  ) as Record<PlacementCategory, Rng>;
  layoutSegment(w, ctx, input, rngs, pathLength);
  return w.pack(caps);
}

function layoutSegment(
  w: PlacementWriter,
  ctx: GeometryBuildContext,
  input: SegmentPlacementInput,
  R: Record<PlacementCategory, Rng>,
  len: number,
): void {
  const L = input.layout;
  const { canyonWidth, waterWidth } = ctx;
  const half = canyonWidth / 2;
  const bankStart = waterWidth / 2;
  const slot = L.isSlotCanyon;
  const glacier = L.isGlacier;
  const pond = L.segmentType === 'pond';
  const autumn = L.isAutumnLike;
  const tube = !!ctx.tubeProfile;
  const W = WATER_LEVEL;
  const PI = Math.PI;

  // Authored overrides first (legacy order); the procedural pass skips their category.
  if (input.trees) for (const o of input.trees) snapOverride(w, ctx, 'trees', o, R.trees, 0);
  if (input.rocks) {
    for (const o of input.rocks) {
      const near = Math.abs(o.localX) > bankStart + 3 ? PlacementAux.NEAR_WALL : 0;
      snapOverride(w, ctx, 'rocks', o, R.rocks, near | rockTypeFlag(o.rockType));
    }
  }

  const zSteps = Math.ceil(len / 2);
  const ds = (metres: number) => metres / len;
  /** Lateral `u` bank units out from the bank edge on `side` (0 = wetted edge, 1 = tile edge). */
  const bankUnits = (side: number, edge: number, u: number) => side * (edge + u * Math.max(0, half - edge));

  for (let z = 0; z < zSteps; z += 1) {
    const s = z / zSteps;
    const shape: ChannelShape = sampleChannelShape(ctx.channelProfile, waterWidth, s);
    const tangent = pathTangent(ctx.segmentPath, s);
    const sNext = Math.min(1, s + 1 / Math.max(1, zSteps));
    const tangentNext = pathTangent(ctx.segmentPath, sNext);
    const curvatureY = tangent.z * tangentNext.x - tangent.x * tangentNext.z;
    const curvatureStrength = Math.abs(curvatureY);
    const insideSide = curvatureY > 0 ? -1 : 1;
    const flowYaw = Math.atan2(tangent.x, tangent.z);

    for (const side of [-1, 1]) {
      const edge = side < 0 ? shape.leftHalfWidth : shape.rightHalfWidth;
      const riffle = Math.max(0, shape.riffleStrength);

      // 1. ROCKS (large), their scatter and wake foam.
      if (!input.rocks) {
        const r = R.rocks;
        const chance = pond ? 0.3 : slot ? 0.8 : (ROCK_CHANCE[L.rockDensity] || 0.4) + riffle * 0.22;
        const roll = r();
        const dist = edge + 0.6 + r() * (2.6 + riffle * 1.5);
        const scale = 0.8 + r() * 0.8;
        const rx = r() * PI;
        const ry = r() * PI;
        const rz = r() * PI;
        const lat = side * dist;
        if (roll > 1 - chance && w.onGround(s, lat, ANY_GROUND)) {
          const near = dist > bankStart + 3 ? PlacementAux.NEAR_WALL : 0;
          w.pushGround('rocks', s, lat, w.ground, 0, rx, ry, rz, scale, scale, scale, near);
          const sr = R.scatterRocks;
          const scatterCount = 2 + Math.floor(sr() * 4);
          for (let k = 0; k < scatterCount; k += 1) {
            const ss = s + ds((sr() - 0.5) * 2.4);
            const sl = lat + (sr() - 0.5) * 2.2;
            const srx = sr() * PI;
            const sry = sr() * PI * 2;
            const srz = sr() * PI;
            if (w.onGround(ss, sl, DRY | bandBit(TerrainBand.RIM)) && w.ground.y > W) {
              w.pushGround('scatterRocks', ss, sl, w.ground, 0.05, srx, sry, srz, 1, 1, 1, near);
            }
          }
          if (Math.abs(lat) < waterWidth / 2 - 1.0) {
            const fs = scale * 3.0;
            w.pushAt('rockFoam', PlacementAnchor.WATER, s, lat, W + 0.05, -PI / 2, flowYaw, 0, fs, fs, 1);
          }
        }
      }

      // 2. TREES / DESERT FLORA.
      if (!input.trees) {
        if (slot) {
          const r = R.cactus;
          const roll = r();
          const dist = bankStart + canyonWidth * 0.22 + r() * canyonWidth * 0.16;
          const yaw = r() * PI * 2;
          const pick = r();
          const sc = r();
          const lat = side * dist;
          if (roll > 1 - 0.36 && dist > waterWidth * 0.6 && w.onGround(s, lat, DRY, true)) {
            if (pick > 0.5) {
              const k = 0.7 + sc * 0.6;
              w.pushGround('cactus', s, lat, w.ground, 0.05, 0, yaw, 0, k, k, k);
            } else {
              const k = 0.9 + sc * 0.7;
              w.pushGround('desertSage', s, lat, w.ground, 0.05, 0, yaw, 0, k, k, k);
            }
          }
        } else {
          const r = R.trees;
          const chance = (autumn || pond ? 0.6 : 0.3) * L.treeDensity;
          const roll = r();
          const u = 0.2 + r() * 0.55;
          const scale = 1.5 + r() * 1.0;
          const yaw = r() * PI * 2;
          const lat = bankUnits(side, edge, u);
          if (roll > 1 - chance && w.onGround(s, lat, BANK_ONLY, true)) {
            w.pushGround('trees', s, lat, w.ground, 0.1, 0, yaw, 0, scale, scale, scale);
            const pc = R.pinecones;
            const n = 2 + Math.floor(pc() * 4);
            for (let k = 0; k < n; k += 1) {
              const d = 0.5 + pc() * 1.5;
              const ang = pc() * PI * 2;
              const k3 = 0.15 + pc() * 0.1;
              const prx = pc() * PI;
              const pry = pc() * PI;
              const prz = pc() * PI;
              const ps = s + ds(Math.sin(ang) * d);
              const pl = lat + Math.cos(ang) * d;
              if (w.onGround(ps, pl, DRY)) w.pushGround('pinecones', ps, pl, w.ground, 0.05, prx, pry, prz, k3, k3, k3);
            }
          }
        }
      }

      // PEBBLES (shoreline scatter, either side of the waterline).
      {
        const r = R.pebbles;
        if (r() > 0.3) {
          const n = 1 + Math.floor(r() * 3);
          for (let k = 0; k < n; k += 1) {
            const lat = side * (edge + (r() - 0.2) * 1.5);
            const scale = 0.5 + r() * 0.6;
            const rx = r() * PI;
            const ry = r() * PI;
            const rz = r() * PI;
            if (w.onGround(s, lat, SHORE)) w.pushGround('pebbles', s, lat, w.ground, 0.1, rx, ry, rz, scale, scale, scale);
          }
        }
      }

      // 3.6 SAND BARS: point bars on inside bends (summer), on the water sheet.
      if (L.isSummerLike && !slot && side === insideSide && curvatureStrength > 0.008) {
        const r = R.sandBars;
        if (r() > 0.55) {
          const barWidth = 2.5 + r() * 3.0;
          const barLength = barWidth * (0.55 + r() * 0.25);
          const lat = side * (bankStart * 0.58 + r() * bankStart * 0.32);
          const y = W + 0.08 + r() * 0.12;
          // rot slot carries the bar's tangent, scale slot (width, length).
          w.pushAt('sandBars', PlacementAnchor.WATER, s, lat, y, tangent.x, tangent.y, tangent.z, barWidth, barLength, 0);
          const pb = R.pebbles;
          const n = 3 + Math.floor(pb() * 5);
          for (let k = 0; k < n; k += 1) {
            const along = (pb() - 0.5) * barLength * 1.7;
            const across = (pb() - 0.5) * barWidth * 0.9;
            const scale = 0.45 + pb() * 0.55;
            const rx = pb() * PI;
            const ry = pb() * PI;
            const rz = pb() * PI;
            w.pushAt('pebbles', PlacementAnchor.WATER, s + ds(along), lat + across, y + 0.02, rx, ry, rz, scale, scale, scale);
          }
        }
      }

      // 4. GRASS (and Foliage, which reads the same list).
      if (!slot && !glacier) {
        const r = R.grass;
        if (r() > 0.6) {
          const lat = side * (edge + r() * 4);
          const yaw = r();
          if (w.onGround(s, lat, DRY, true)) w.pushGround('grass', s, lat, w.ground, 0.05, 0, yaw, 0, 0.5, 0.5, 0.5);
        }
      }

      // 4.1 CANYON GRASS (slot waterline).
      if (slot) {
        const r = R.canyonGrass;
        if (r() > 0.48) {
          const lat = side * (edge + 0.6 + r() * Math.max(0.4, bankStart * 0.35));
          const scale = 0.55 + r() * 0.45;
          const yaw = r() * PI * 2;
          if (w.onGround(s, lat, ANY_GROUND) && w.ground.y > W - 0.1) {
            w.pushGround('canyonGrass', s, lat, w.ground, 0.05, 0, yaw, 0, scale, scale, scale);
          }
        }
      }

      // 4.5 WILDFLOWERS — denser near the waterline, clumped.
      if (!slot && !glacier) {
        const r = R.wildflowers;
        const bankHeight = Math.max(1.5, L.wallHeight * 0.55);
        const minD = 0.35;
        const maxD = Math.min(7.5, canyonWidth * 0.18);
        const lat = side * (edge + minD + r() * Math.max(0.5, maxD - minD));
        const roll = r();
        const clusterSize = 2 + Math.floor(r() * 3);
        const baseScale = autumn ? 0.55 + r() * 0.28 : 0.6 + r() * 0.35;
        if (w.onGround(s, lat, DRY, true)) {
          const above = Math.max(0, w.ground.y - W);
          const waterline = Math.min(1, above / bankHeight);
          const hi = autumn ? 0.52 : 0.72;
          const lo = autumn ? 0.14 : 0.2;
          const boost = L.segmentType === 'normal' && L.particleCount > 0 ? Math.min(L.particleCount / 60, 2.5) : 1.0;
          if (roll < (hi + (lo - hi) * waterline) * boost) {
            for (let k = 0; k < clusterSize; k += 1) {
              const along = k === 0 ? 0 : (r() - 0.5) * 1.2;
              const across = k === 0 ? 0 : (r() - 0.5) * 0.9;
              const mod = k === 0 ? 1 : 0.78 + r() * 0.32;
              const yaw = r() * PI * 2;
              const sy = baseScale * (0.9 + r() * 0.4);
              const fs = s + ds(along);
              const fl = lat + across;
              if (w.onGround(fs, fl, DRY, true)) {
                w.pushGround('wildflowers', fs, fl, w.ground, 0.05, 0, yaw, 0, baseScale * mod, sy, baseScale * mod);
              }
            }
          }
        }
      }

      // 4.6 FERNS — undergrowth between the water and the wall.
      if (!slot && !glacier) {
        const r = R.ferns;
        const chance = L.isLumberFlume ? 0.7 : autumn ? 0.4 : 0.3;
        if (r() > 1 - chance) {
          const n = 3 + Math.floor(r() * 3);
          const baseU = 0.15 + r() * 0.45;
          for (let k = 0; k < n; k += 1) {
            const lat = bankUnits(side, edge, baseU) + (r() - 0.5) * 3.0;
            const fs = s + ds((r() - 0.5) * 3.0);
            const scale = 0.8 + r() * 0.6;
            const yaw = r() * PI * 2;
            if (w.onGround(fs, lat, DRY, true)) w.pushGround('ferns', fs, lat, w.ground, 0.05, 0, yaw, 0, scale, scale, scale);
          }
        }
      }

      // 4.7 MUSHROOMS — forest floor.
      if (!slot && !glacier) {
        const r = R.mushrooms;
        if (r() > 1 - (autumn ? 0.6 : 0.3)) {
          const n = 3 + Math.floor(r() * 5);
          const baseU = 0.1 + r() * 0.4;
          for (let k = 0; k < n; k += 1) {
            const lat = bankUnits(side, edge, baseU) + (r() - 0.5) * 1.5;
            const ms = s + ds((r() - 0.5) * 1.5);
            const scale = 0.8 + r() * 0.6;
            const rx = (r() - 0.5) * 0.2;
            const ry = r() * PI * 2;
            const rz = (r() - 0.5) * 0.2;
            if (w.onGround(ms, lat, DRY, true)) w.pushGround('mushrooms', ms, lat, w.ground, 0.02, rx, ry, rz, scale, scale, scale);
          }
        }
      }

      // 5. REEDS — planted at the waterline.
      if (!slot && !glacier) {
        const r = R.reeds;
        if (r() > 0.5) {
          const lat = side * (edge + (r() - 0.2) * 1.5);
          const scale = 0.8 + r() * 0.4;
          const yaw = r() * PI * 2;
          if (w.onGround(s, lat, SHORE)) w.pushGround('reeds', s, lat, w.ground, 0.15, 0, yaw, 0, scale, scale, scale);
        }
      }

      // 6. DRIFTWOOD — on the bank, or floating where the ground is under water.
      if (!slot && !glacier) {
        const r = R.driftwood;
        if (r() > 0.25) {
          const pile = r() > 0.7;
          const n = pile ? 3 + Math.floor(r() * 4) : 1 + Math.floor(r() * 2);
          const baseDist = edge + (r() - 0.1) * 3.0;
          for (let k = 0; k < n; k += 1) {
            const along = (r() - 0.5) * (pile ? 3.0 : 1.5);
            const lat = side * (baseDist + (r() - 0.5) * (pile ? 2.5 : 1.0));
            const scale = 0.7 + r() * 0.8;
            const rx = (r() - 0.5) * 0.5;
            const ry = r() * PI * 2;
            const rz = (r() - 0.5) * 0.5;
            const dws = s + ds(along);
            if (!w.onGround(dws, lat, SHORE)) continue;
            if (w.ground.y < W) w.pushAt('driftwood', PlacementAnchor.WATER, dws, lat, W, rx, ry, rz, scale, scale, scale);
            else w.pushGround('driftwood', dws, lat, w.ground, 0.05, rx, ry, rz, scale, scale, scale);
          }
        }
      }

      // 7. LEAVES (falling), from the canopy height but never inside the ground.
      {
        const r = R.leaves;
        if (r() > 1 - (autumn ? 0.8 : 0.2)) {
          const n = autumn ? 3 + Math.floor(r() * 5) : 1;
          for (let k = 0; k < n; k += 1) {
            const lat = (r() - 0.5) * canyonWidth * 0.9;
            const ls = s + ds((r() - 0.5) * 5.0);
            const y = Math.max(15 + r() * 10, w.groundOrWater(ls, lat) + 3);
            const yaw = r() * PI * 2;
            w.pushAt('leaves', PlacementAnchor.AIR, ls, lat, y, 0, yaw, 0, 1, 1, 1);
          }
        }
      }

      // 7.5 FLOATING LEAVES (pond), on the water sheet.
      if (pond) {
        const r = R.floatingLeaves;
        if (r() > 0.4) {
          const n = 1 + Math.floor(r() * 3);
          for (let k = 0; k < n; k += 1) {
            const lat = (r() - 0.5) * waterWidth * 0.9;
            const ls = s + ds((r() - 0.5) * 4.0);
            const yaw = r() * PI * 2;
            w.pushAt('floatingLeaves', PlacementAnchor.WATER, ls, lat, W, 0, yaw, 0, 1, 1, 1);
          }
        }
      }

      // 8. FIREFLIES — 1–4 m over the ground or water.
      {
        const r = R.fireflies;
        if (r() > 0.8) {
          const lat = (r() - 0.5) * canyonWidth * 0.9;
          const y = w.groundOrWater(s, lat) + 1.0 + r() * 3.0;
          w.pushAt('fireflies', PlacementAnchor.AIR, s, lat, y, 0, 0, 0, 1, 1, 1);
        }
      }

      // 9. BIRDS (and the bats that roost with them).
      if (side === 1 && w.count('birds') < 8) {
        const r = R.birds;
        const target = slot ? 2 + Math.floor(r() * 3) : 4 + Math.floor(r() * 5);
        if (r() < (slot ? 0.18 : 0.12)) {
          let lat: number;
          let bs: number;
          let y: number;
          if (slot) {
            lat = (r() - 0.5) * canyonWidth * 0.45;
            bs = s + ds((r() - 0.5) * 6.0);
            y = W + L.wallHeight * 0.45 + r() * 4.0;
          } else {
            const sign = r() > 0.5 ? 1 : -1;
            lat = sign * (bankStart + 3 + r() * 5.0);
            bs = s + ds((r() - 0.5) * 5.0);
            y = 5.5 + r() * 4.0;
          }
          y = Math.max(y, w.groundOrWater(bs, lat) + 3);

          if ((slot || autumn) && w.count('bats') < 12) {
            const b = R.bats;
            const batTarget = 6 + Math.floor(b() * 7);
            if (b() < (slot ? 0.5 : 0.42)) {
              const sign = b() > 0.5 ? 1 : -1;
              const blat = slot ? sign * (waterWidth * 0.48 + b() * 1.8) : sign * (bankStart + 4.5 + b() * 4.0);
              const bss = s + ds((b() - 0.5) * 7.0);
              const by = Math.max(W + 2 + b() * 2.0, w.groundOrWater(bss, blat) + 0.6);
              w.pushAt('bats', PlacementAnchor.AIR, bss, blat, by, 0, 0, 0, 1, 1, 1);
            }
            if (w.count('bats') > batTarget) w.truncate('bats', batTarget);
          }

          w.pushAt('birds', PlacementAnchor.AIR, bs, lat, y, 0, 0, 0, 1, 1, 1);
          if (!slot && w.count('birds') < target && r() < 0.5) {
            const bl = lat + (r() - 0.5) * 2.5;
            const bb = bs + ds((r() - 0.5) * 2.5);
            const yy = y + (r() - 0.5) * 1.2;
            w.pushAt('birds', PlacementAnchor.AIR, bb, bl, yy, 0, 0, 0, 1, 1, 1);
          }
        }
      }

      // 10. FISH (pond), under the sheet and above the bed.
      if (!slot && pond) {
        const r = R.fish;
        if (r() > 0.6) {
          const lat = (r() - 0.5) * waterWidth * 0.8;
          const yaw = r() * PI * 2;
          const g = sampleTile(w.floor, s, lat, w.ground);
          const y = Math.min(W - 0.1, Math.max(W - 0.5, g.ok ? g.y + 0.15 : W - 0.5));
          w.pushAt('fish', PlacementAnchor.WATER, s, lat, y, 0, yaw, 0, 1, 1, 1);
        }
      }

      // 11. MIST over the water (waterfalls have their own particles).
      if (L.segmentType !== 'waterfall') {
        const r = R.mist;
        if (slot) {
          const low = L.lodQuality === 'low';
          if (r() > (low ? 0.55 : 0.42)) {
            const n = low ? 1 + Math.floor(r() * 2) : 2 + Math.floor(r() * 4);
            for (let k = 0; k < n; k += 1) {
              const lat = (r() - 0.5) * waterWidth * 0.95;
              const y = W + r() * 2.0;
              const sx = 2.0 + r() * 2.0;
              const sy = 1.2 + r() * 1.4;
              const sz = 1.5 + r() * 1.5;
              w.pushAt('mist', PlacementAnchor.WATER, s, lat, y, 0, 0, 0, sx, sy, sz);
            }
          }
          if ((L.lodQuality === 'high' || L.lodQuality === 'ultra') && r() > 0.6) {
            const n = 1 + Math.floor(r() * 2);
            for (let k = 0; k < n; k += 1) {
              const lat = (r() - 0.5) * waterWidth * 0.5;
              const y = W + 3.0 + r() * 7.0;
              const sx = 0.5 + r() * 0.7;
              const sy = 3.0 + r() * 4.0;
              const sz = 0.4 + r() * 0.6;
              w.pushAt('mist', PlacementAnchor.AIR, s, lat, y, 0, 0, 0, sx, sy, sz, PlacementAux.MIST_COLUMN);
            }
          }
        } else if (r() > 0.6) {
          const n = 1 + Math.floor(r() * 2);
          for (let k = 0; k < n; k += 1) {
            const lat = (r() - 0.5) * waterWidth * 0.8;
            const y = W + 0.2 + r() * 2.0;
            w.pushAt('mist', PlacementAnchor.WATER, s, lat, y, 0, 0, 0, 1, 1, 1);
          }
        }
      }

      // 12. WATER LILIES (pond), on the sheet away from the bank.
      if (pond) {
        const r = R.waterLilies;
        if (r() > 0.85) {
          const n = 3 + Math.floor(r() * 5);
          const base = (r() - 0.5) * waterWidth * 0.7;
          for (let k = 0; k < n; k += 1) {
            const lx = base + (r() - 0.5) * 2.0;
            const lz = (r() - 0.5) * 2.0;
            const scale = 0.8 + r() * 0.4;
            const yaw = r() * PI * 2;
            if (Math.abs(lx) > waterWidth / 2 - 2) continue;
            w.pushAt('waterLilies', PlacementAnchor.WATER, s + ds(lz), lx, W, 0, yaw, 0, scale, scale, scale);
          }
        }
      }

      // 13. SUN SHAFTS, high over the channel (path-relative, never world Y).
      {
        const r = R.sunShafts;
        if (slot) {
          if (r() > 0.68) {
            const lat = (r() - 0.5) * waterWidth * 0.6;
            const y = 20 + r() * 8;
            const k = 0.4 + r() * 0.3;
            const q = SLOT_SHAFT_ROTATION;
            w.pushAt('sunShafts', PlacementAnchor.AIR, s, lat, y, q.x, q.y, q.z, k * 0.5, k * 2.5, k * 0.5);
          }
        } else if (!autumn || pond) {
          if (r() > (L.isLumberFlume ? 0.72 : 0.92)) {
            const lat = (r() - 0.5) * canyonWidth * 0.6;
            const y = 12 + r() * 5;
            const k = 0.8 + r() * 0.4;
            const q = OPEN_SHAFT_ROTATION;
            w.pushAt('sunShafts', PlacementAnchor.AIR, s, lat, y, q.x, q.y, q.z, k, k * 1.5, k);
          }
        }
      }

      // 14. RAPIDS — whitewater in the corridor.
      if (!slot && L.flowSpeed > 0.8 && !pond) {
        const r = R.rapids;
        const chance = (L.rockDensity === 'high' ? 0.35 : 0.15) + riffle * 0.45;
        if (r() > 1 - chance) {
          const n = 1 + Math.floor(r() * 3);
          const spread = shape.corridorHalfWidth * 1.4;
          for (let k = 0; k < n; k += 1) {
            const lat = (r() - 0.5) * spread;
            const rs = s + ds((r() - 0.5) * 2.0);
            const scale = 0.8 + r() * 0.8;
            const rx = r() * PI;
            const ry = r() * PI;
            const rz = r() * PI;
            w.pushAt('rapids', PlacementAnchor.WATER, rs, lat, W - 0.1, rx, ry, rz, scale, scale, scale);
          }
        }
      }

      // 15. DRAGONFLIES — 1–3 m over the bank or the water.
      if (!slot && !autumn && L.segmentType !== 'waterfall') {
        const r = R.dragonflies;
        if (r() > 0.7) {
          const n = 1 + Math.floor(r() * 3);
          const lat = side * (edge + (r() - 0.5) * 4.0);
          const y = w.groundOrWater(s, lat) + 1.0 + r() * 2.0;
          for (let k = 0; k < n; k += 1) {
            const dl = lat + (r() - 0.5) * 1.0;
            const dds = s + ds((r() - 0.5) * 1.0);
            const dy = y + (r() - 0.5) * 0.5;
            const yaw = r() * PI * 2;
            w.pushAt('dragonflies', PlacementAnchor.AIR, dds, dl, dy, 0, yaw, 0, 1, 1, 1);
          }
        }
      }

      // 16. GLACIAL — icicles hanging from the tube crown, or off the open wall.
      if (glacier) {
        const r = R.icicles;
        if (r() > 0.55) {
          const lat = side * (edge + 1.8 + r() * 3.5);
          const sy = 1.2 + r() * 2.8;
          const rx = (r() - 0.5) * 0.15;
          const ry = r() * PI * 2;
          const rz = (r() - 0.5) * 0.1;
          const sx = 0.7 + r() * 0.6;
          const sz = 0.7 + r() * 0.5;
          const crown = tube ? sampleTile(w.floor, s, lat, w.ground, TileBranch.CROWN) : null;
          if (crown?.ok && crown.band === TerrainBand.CROWN) {
            w.pushGround('icicles', s, lat, w.ground, 0, rx, ry, rz, sx, sy, sz);
          } else if (w.onGround(s, lat, DRY | bandBit(TerrainBand.RIM))) {
            w.pushGround('icicles', s, lat, w.ground, 0, rx, ry, rz, sx, sy, sz);
          }
        }
      }

      // 17. GLACIAL — ice shelves at the waterline, on the sheet.
      if (glacier) {
        const r = R.iceSheets;
        if (r() > 0.62) {
          const lat = side * (bankStart + 0.4 + r() * 1.2);
          const y = W + 0.05 + r() * 0.15;
          const span = 1.4 + r() * 2.6;
          const rx = (r() - 0.5) * 0.2;
          const rz = (r() - 0.5) * 0.12;
          const sz = 0.5 + r() * 0.8;
          w.pushAt('iceSheets', PlacementAnchor.WATER, s, lat, y, rx, flowYaw, rz, span, 1, sz);
        }
      }
    }
  }

  // Rim tree silhouettes: on the top surface at the rim — the wall shell, or
  // the lip of the slot's own walls (the slot shell sits inside them).
  {
    const r = R.rimTrees;
    for (const side of [-1, 1]) {
      const n = slot ? 3 + Math.floor(r() * 2) : 3 + Math.floor(r() * 4);
      for (let i = 0; i < n && w.count('rimTrees') < 12; i += 1) {
        const base = (i + 0.5) / n;
        const s = Math.max(0.03, Math.min(0.97, base + (r() - 0.5) * 0.28));
        const baseScale = slot ? 0.85 + r() * 0.65 : 1.0 + r() * 1.1;
        const yaw = r() * PI * 2;
        const lat = side * (slot ? half - 0.3 : canyonWidth * 0.72);
        const onFloor = sampleTile(w.floor, s, lat, w.ground).ok && !w.ground.covered && w.ground.band !== TerrainBand.CROWN;
        const onShell = !!w.shellTile && sampleTile(w.shellTile, s, lat, w.shell).ok;
        const top = onFloor && (!onShell || w.ground.y >= w.shell.y) ? w.ground : onShell ? w.shell : null;
        if (!top) continue;
        top.band = TerrainBand.RIM;
        const sx = slot ? baseScale * 1.2 : baseScale * 0.8;
        const sy = slot ? baseScale * 0.85 : baseScale * 1.7;
        w.pushGround('rimTrees', s, lat, top, 0.1, 0, yaw, 0, sx, sy, sx);
      }
    }
  }

  // Bats: slot and autumn canyons always roost a few.
  if (slot || autumn) {
    const b = R.bats;
    if (w.count('bats') < 6) {
      const target = 6 + Math.floor(b() * 7);
      const missing = target - w.count('bats');
      for (let i = 0; i < missing; i += 1) {
        const s = Math.max(0.02, Math.min(0.98, b()));
        const sign = b() > 0.5 ? 1 : -1;
        const lat = slot ? sign * (waterWidth * 0.46 + b() * 2.1) : sign * (bankStart + 4.0 + b() * 4.0);
        const y = Math.max(W + 2 + b() * 2.0, w.groundOrWater(s, lat) + 0.6);
        w.pushAt('bats', PlacementAnchor.AIR, s, lat, y, 0, 0, 0, 1, 1, 1);
      }
    }
  }
}

/** Transfer list for a placement buffer (one buffer, by design). */
export function placementTransferables(buffer: ArrayBuffer | null | undefined): ArrayBuffer[] {
  return buffer ? [buffer] : [];
}
