/**
 * sweScroll — keeps the player-centred SWE window world-stable.
 *
 * The live field is a window over the world that follows the vehicle. `b` is
 * re-rasterized from the canyon into each new window, but h / u / w carry state:
 * unless they move with the world, a splash rides the camera. This module owns
 * the two pure halves of the fix; the solver-side scroll is `scrollShallowWater`
 * (emscripten/swe.cpp, WGSL twin in swe.wgsl).
 *
 *   advanceSweWindow  the window origin as a whole-cell lattice position, with
 *                     the same one-cell hysteresis the bed refresh always had,
 *                     and the whole-cell shift to hand the solver.
 *   scrollField       a TypeScript reference of the same scroll, for the WGSL
 *                     backend's CPU mirror and for a binary that predates the
 *                     export. It is data movement only — never a second solver.
 *
 * Pure module — no React, no THREE, no WASM. Tested in sweScroll.test.ts.
 */
import type { SWEBudget } from './sweQuality';

/** Where a window sits on the world's cell lattice. */
export interface SweWindow {
  /** Lattice coordinates: origin = cell * cellSize. Integers. */
  cellX: number;
  cellZ: number;
  /** World XZ of grid cell (0, 0). Always an exact multiple of the cell size. */
  originX: number;
  originZ: number;
}

export interface SweWindowStep {
  window: SweWindow;
  /**
   * Whole cells to scroll the field by, in `scrollShallowWater`'s convention:
   * how far the CONTENT moves through the index frame, (oldOrigin − newOrigin) /
   * cellSize. A window travelling downstream (−Z) yields a positive `shiftZ`.
   */
  shiftX: number;
  shiftZ: number;
}

type WindowBudget = Pick<SWEBudget, 'width' | 'height' | 'cellSize'>;

function windowAt(cellX: number, cellZ: number, cellSize: number): SweWindow {
  return { cellX, cellZ, originX: cellX * cellSize, originZ: cellZ * cellSize };
}

/**
 * Next window for a vehicle at (`anchorX`, `anchorZ`).
 *
 * The window centres on the anchor, but only ever sits on the lattice of
 * multiples of `cellSize`, so a cell keeps the same world position for as long
 * as it survives and the bed rasterizer samples the same world points every
 * time. It moves by whole cells and only once the desired origin has drifted a
 * full cell from where it sits — sub-cell motion neither scrolls nor
 * re-rasterizes the bed, and a vehicle jittering across a cell boundary cannot
 * make the field thrash. The window therefore lags the ideal centre by less
 * than one cell. `prev` is null on the first frame after the grid is (re)built.
 *
 * Returns null for a non-finite anchor, so a physics glitch cannot poison the
 * window state — the caller keeps its previous window.
 */
export function advanceSweWindow(
  prev: SweWindow | null,
  anchorX: number,
  anchorZ: number,
  budget: WindowBudget,
): SweWindowStep | null {
  const { cellSize } = budget;
  const wantX = anchorX / cellSize - budget.width * 0.5;
  const wantZ = anchorZ / cellSize - budget.height * 0.5;
  if (!Number.isFinite(wantX) || !Number.isFinite(wantZ)) return null;

  if (!prev) {
    return { window: windowAt(Math.round(wantX), Math.round(wantZ), cellSize), shiftX: 0, shiftZ: 0 };
  }

  // Math.trunc: move only by the whole cells of drift, keeping the sub-cell
  // remainder as hysteresis. `+ 0` folds −0 into 0.
  const moveX = Math.trunc(wantX - prev.cellX) + 0;
  const moveZ = Math.trunc(wantZ - prev.cellZ) + 0;
  if (moveX === 0 && moveZ === 0) return { window: prev, shiftX: 0, shiftZ: 0 };

  return {
    window: windowAt(prev.cellX + moveX, prev.cellZ + moveZ, cellSize),
    shiftX: -moveX + 0,
    shiftZ: -moveZ + 0,
  };
}

/** State an entering cell takes: the ABI's own fields, (η, u, w). */
export interface SweInflow {
  eta: number;
  u: number;
  w: number;
}

/** Rest state — a still surface at the datum. What the runtime passes today. */
export const SWE_REST_INFLOW: Readonly<SweInflow> = Object.freeze({ eta: 0, u: 0, w: 0 });

let scratch = new Float32Array(0);

/**
 * dst[x, z] = src[x − shiftX, z − shiftZ] in place. Out-of-range sources become
 * `fill`, or the nearest edge cell when `fill` is null (used for the bed).
 * Mirrors `scrollPlane` in swe.cpp.
 */
function scrollPlane(
  plane: Float32Array,
  width: number,
  height: number,
  shiftX: number,
  shiftZ: number,
  fill: number | null,
): void {
  const count = width * height;
  if (scratch.length < count) scratch = new Float32Array(count);
  for (let z = 0; z < height; z += 1) {
    const sz = z - shiftZ;
    for (let x = 0; x < width; x += 1) {
      const sx = x - shiftX;
      let v: number;
      if (sx >= 0 && sx < width && sz >= 0 && sz < height) {
        v = plane[sz * width + sx];
      } else if (fill === null) {
        v = plane[Math.min(Math.max(sz, 0), height - 1) * width + Math.min(Math.max(sx, 0), width - 1)];
      } else {
        v = fill;
      }
      scratch[z * width + x] = v;
    }
  }
  plane.set(scratch.subarray(0, count));
}

/**
 * Scroll h / u / w (and b, when given) by whole cells — the TypeScript twin of
 * `scrollShallowWater`. Same sign, same fill, same edge-extended bed, same
 * saturation. Returns false, touching nothing, for a zero or non-finite shift.
 */
export function scrollField(
  planes: { h: Float32Array; u: Float32Array; w: Float32Array; b?: Float32Array | null },
  width: number,
  height: number,
  shiftX: number,
  shiftZ: number,
  inflow: SweInflow = SWE_REST_INFLOW,
): boolean {
  if (!Number.isFinite(shiftX) || !Number.isFinite(shiftZ)) return false;
  // Past one full extent every source is out of range; saturating keeps the
  // index arithmetic small for a teleport-sized delta.
  const sx = Math.max(-width, Math.min(width, Math.trunc(shiftX)));
  const sz = Math.max(-height, Math.min(height, Math.trunc(shiftZ)));
  if (sx === 0 && sz === 0) return false;

  scrollPlane(planes.h, width, height, sx, sz, inflow.eta);
  scrollPlane(planes.u, width, height, sx, sz, inflow.u);
  scrollPlane(planes.w, width, height, sx, sz, inflow.w);
  if (planes.b) scrollPlane(planes.b, width, height, sx, sz, null);
  return true;
}

let texelScratch = new Float32Array(0);

/**
 * Scroll an interleaved `channels`-per-cell plane (the packed flow texture,
 * `SweSim.packSurface`) by whole cells, in place: `dst[x, z] = src[x − shiftX,
 * z − shiftZ]`, with cells that enter taking their nearest surviving texel
 * (the bed's edge rule). Row copies only, no per-cell arithmetic (#533): the
 * worker / WGSL mirrors move their surface plane with h/u/w/b so it stays in
 * the new index frame until the next packed plane replaces all of it.
 */
export function scrollTexels(
  plane: Float32Array,
  width: number,
  height: number,
  channels: number,
  shiftX: number,
  shiftZ: number,
): boolean {
  if (!Number.isFinite(shiftX) || !Number.isFinite(shiftZ)) return false;
  const sx = Math.max(-width, Math.min(width, Math.trunc(shiftX)));
  const sz = Math.max(-height, Math.min(height, Math.trunc(shiftZ)));
  if (sx === 0 && sz === 0) return false;
  const rowLen = width * channels;
  const count = height * rowLen;
  if (texelScratch.length < count) texelScratch = new Float32Array(count);
  // Destination columns whose source is in range: [x0, x1).
  const x0 = Math.max(0, Math.min(width, sx));
  const x1 = Math.max(0, Math.min(width, width + sx));
  for (let z = 0; z < height; z += 1) {
    const srcRow = Math.min(Math.max(z - sz, 0), height - 1) * rowLen;
    const dstRow = z * rowLen;
    if (x1 > x0) {
      texelScratch.set(plane.subarray(srcRow + (x0 - sx) * channels, srcRow + (x1 - sx) * channels), dstRow + x0 * channels);
    }
    // Edge-extend: columns left of the copied span take the source row's
    // first texel, columns right of it its last (scrollShallowWater's bed rule).
    const left = plane.subarray(srcRow, srcRow + channels);
    for (let x = 0; x < x0; x += 1) texelScratch.set(left, dstRow + x * channels);
    const right = plane.subarray(srcRow + (width - 1) * channels, srcRow + width * channels);
    for (let x = Math.max(x1, x0); x < width; x += 1) texelScratch.set(right, dstRow + x * channels);
  }
  plane.set(texelScratch.subarray(0, count));
  return true;
}
