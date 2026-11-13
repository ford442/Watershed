/**
 * The placement buffer's wire format (#487 D Phase B; split out of
 * `terrain/placement.ts` in #559 C): the 31 categories, the Uint32 header, the
 * Float32 record layout, the aux bits, and the reader. Three-free, shared by
 * the builder (main thread and sim worker) and `usePlacementData`.
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

import type { TerrainBandId } from '../terrainTile';

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

export const CATEGORY_INDEX: Readonly<Record<PlacementCategory, number>> = Object.fromEntries(
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

/** Transfer list for a placement buffer (one buffer, by design). */
export function placementTransferables(buffer: ArrayBuffer | null | undefined): ArrayBuffer[] {
  return buffer ? [buffer] : [];
}
