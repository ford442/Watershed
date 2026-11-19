/**
 * telegraphGeometry.ts — where a hazard's water will reach, as triangles (#578 A.2).
 *
 * A release raises its reach to an authored `stage` (m above the still water
 * sheet, pinned to the router's rating by hydroContrast.release.test.ts). The
 * telegraph draws that height on the canyon itself, from the same hull the SWE
 * bed and the Rapier floor are built from (`BathymetrySource.sampleFloorHeight`):
 *
 *  - the wall band: on each bank, a strip lying on the wall from a little under
 *    the predicted waterline to a little over it — the wet line to come;
 *  - the water-edge decal: a sheet across the channel at the predicted surface,
 *    from one bank's predicted edge to the other's, wound counter-clockwise from
 *    above (its face normal is +Y going downstream), so a one-sided material
 *    shows it from above and hides it from below.
 *
 * For every centreline sample within the hazard's reach it walks out from the
 * path on both sides until the floor rises through each height (linear between
 * steps), so the band follows the real wall, slot or bowl alike. A sample whose
 * bank never reaches the height inside `MAX_LATERAL` (an open pond, no hull)
 * breaks the strip there. Pure: no three, no globals — the component turns the
 * arrays into BufferGeometry.
 */
import type { SegmentFrame } from '../../systems/map/segmentFrames';

/** What the builder reads of a segment's hull (bathymetrySampler's BathymetrySource). */
export interface TelegraphFloor {
  /** Hull floor height above the path at world (x, z), or null where the hull does not cover. */
  sampleFloorHeight(worldX: number, worldZ: number): number | null;
}

export interface TelegraphInput {
  anchor: readonly [number, number, number];
  /** Horizontal metres from the anchor the band spans. */
  radius: number;
  /** Floor height above the path the water will reach: WATER_LEVEL + the hazard's stage. */
  reachHeight: number;
  frames: ReadonlyArray<SegmentFrame>;
  floorFor(segmentIndex: number): TelegraphFloor | null;
}

export interface TelegraphBuffers {
  /** Wall band, both banks: indexed triangles. */
  band: { positions: Float32Array; index: Uint32Array };
  /** Water-edge decal across the channel: indexed triangles. */
  decal: { positions: Float32Array; index: Uint32Array };
}

/** The band runs from this far under the predicted line… */
export const BAND_BELOW = 0.18;
/** …to this far over it (m of floor height). */
export const BAND_ABOVE = 0.42;
/** The decal sits this far above the predicted surface, clear of the live water. */
export const DECAL_LIFT = 0.03;
/** The band is pulled this far off the wall toward the channel, clear of the rock. */
const BAND_INSET = 0.06;
/** Lateral march: step and the widest bank searched (m). */
const LATERAL_STEP = 0.5;
const MAX_LATERAL = 48;

/** Lateral offsets (m) at which the floor first rises through each of `heights` (ascending), or null. */
function crossings(
  floor: TelegraphFloor,
  x: number,
  z: number,
  rx: number,
  rz: number,
  heights: readonly number[],
  out: (number | null)[],
): void {
  for (let i = 0; i < heights.length; i += 1) out[i] = null;
  let next = 0;
  let prevL = 0;
  let prevH = floor.sampleFloorHeight(x, z);
  for (let l = LATERAL_STEP; l <= MAX_LATERAL && next < heights.length; l += LATERAL_STEP) {
    const h = floor.sampleFloorHeight(x + rx * l, z + rz * l);
    if (h === null) return; // off the hull: no wall to draw on beyond here
    while (next < heights.length && h >= heights[next]!) {
      const target = heights[next]!;
      // Linear between the last two steps (the first step out from the path has no previous).
      out[next] = prevH !== null && h > prevH && target > prevH ? prevL + ((target - prevH) / (h - prevH)) * (l - prevL) : l;
      next += 1;
    }
    prevL = l;
    prevH = h;
  }
}

/** Triangles for one hazard's telegraph; empty buffers when nothing of it is live. */
export function buildTelegraphBuffers(input: TelegraphInput): TelegraphBuffers {
  const { anchor, radius, reachHeight, frames } = input;
  const heights = [reachHeight - BAND_BELOW, reachHeight, reachHeight + BAND_ABOVE];
  const hit: (number | null)[] = [null, null, null];
  const r2 = radius * radius;

  const band: number[] = [];
  const bandIndex: number[] = [];
  const decal: number[] = [];
  const decalIndex: number[] = [];
  // Previous row's vertex base per strip (−1 = strip broken): left band, right band, decal.
  let prevLeft = -1;
  let prevRight = -1;
  let prevDecal = -1;

  const ordered = [...frames].sort((a, b) => a.index - b.index);
  let lastIndex = Number.NaN;
  for (const frame of ordered) {
    const floor = input.floorFor(frame.index);
    const { samples } = frame;
    // Strips only join across consecutive segments (their joint is the same sample).
    if (frame.index !== lastIndex + 1) prevLeft = prevRight = prevDecal = -1;
    lastIndex = frame.index;
    if (!floor || samples.length < 2) {
      prevLeft = prevRight = prevDecal = -1;
      continue;
    }
    for (let j = 0; j < samples.length; j += 1) {
      const p = samples[j]!;
      const dx = p[0] - anchor[0];
      const dz = p[2] - anchor[2];
      if (dx * dx + dz * dz > r2) {
        prevLeft = prevRight = prevDecal = -1;
        continue;
      }
      const a = samples[Math.max(0, j - 1)]!;
      const b = samples[Math.min(samples.length - 1, j + 1)]!;
      let tx = b[0] - a[0];
      let tz = b[2] - a[2];
      const len = Math.hypot(tx, tz);
      if (len < 1e-6) {
        tx = 0;
        tz = -1;
      } else {
        tx /= len;
        tz /= len;
      }
      // Horizontal right = tangent × up (segmentFrames.resolveSegmentAnchor).
      const rx = -tz;
      const rz = tx;

      const edges: [number | null, number | null] = [null, null];
      for (const side of [-1, 1] as const) {
        crossings(floor, p[0], p[2], rx * side, rz * side, heights, hit);
        const [lo, mid, hi] = hit;
        const which = side < 0 ? 0 : 1;
        edges[which] = mid;
        const strip = side < 0 ? prevLeft : prevRight;
        if (lo === null || hi === null) {
          if (side < 0) prevLeft = -1;
          else prevRight = -1;
          continue;
        }
        const base = band.length / 3;
        const inLo = Math.max(0, lo - BAND_INSET) * side;
        const inHi = Math.max(0, hi - BAND_INSET) * side;
        band.push(
          p[0] + rx * inLo, p[1] + heights[0]!, p[2] + rz * inLo,
          p[0] + rx * inHi, p[1] + heights[2]!, p[2] + rz * inHi,
        );
        if (strip >= 0) bandIndex.push(strip, strip + 1, base, strip + 1, base + 1, base);
        if (side < 0) prevLeft = base;
        else prevRight = base;
      }

      const [left, right] = edges;
      if (left === null || right === null) {
        prevDecal = -1;
        continue;
      }
      const base = decal.length / 3;
      const y = p[1] + reachHeight + DECAL_LIFT;
      decal.push(p[0] - rx * left, y, p[2] - rz * left, p[0] + rx * right, y, p[2] + rz * right);
      if (prevDecal >= 0) decalIndex.push(prevDecal, prevDecal + 1, base, prevDecal + 1, base + 1, base);
      prevDecal = base;
    }
  }

  return {
    band: { positions: new Float32Array(band), index: new Uint32Array(bandIndex) },
    decal: { positions: new Float32Array(decal), index: new Uint32Array(decalIndex) },
  };
}
