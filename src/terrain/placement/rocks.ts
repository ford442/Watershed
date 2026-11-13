/**
 * Stone and shore (#559 C, from `terrain/placement.ts`): large rocks with
 * their scatter and wake foam, shoreline pebbles, summer sand bars (with the
 * pebbles on them) and driftwood. Categories: rocks, scatterRocks, rockFoam,
 * pebbles, sandBars, driftwood.
 */

import { bandBit, TerrainBand } from '../terrainTile';
import { PlacementAnchor, PlacementAux } from './format';
import {
  input,
  L,
  waterWidth,
  bankStart,
  slot,
  glacier,
  pond,
  s,
  tangent,
  curvatureStrength,
  insideSide,
  flowYaw,
  side,
  edge,
  riffle,
  ds,
  PI,
  W,
  type PlacementRngs,
} from './row';
import { ANY_GROUND, DRY, SHORE, type PlacementWriter } from './writer';

const ROCK_CHANCE: Record<string, number> = { low: 0.4, high: 0.7 };

/** 1. ROCKS (large), their scatter and wake foam. */
export function placeRocks(w: PlacementWriter, R: PlacementRngs): void {
  if (input.rocks) return;
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

/** PEBBLES (shoreline scatter, either side of the waterline). */
export function placePebbles(w: PlacementWriter, R: PlacementRngs): void {
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

/** 3.6 SAND BARS: point bars on inside bends (summer), on the water sheet. */
export function placeSandBars(w: PlacementWriter, R: PlacementRngs): void {
  if (!(L.isSummerLike && !slot && side === insideSide && curvatureStrength > 0.008)) return;
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

/** 6. DRIFTWOOD — on the bank, or floating where the ground is under water. */
export function placeDriftwood(w: PlacementWriter, R: PlacementRngs): void {
  if (slot || glacier) return;
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
