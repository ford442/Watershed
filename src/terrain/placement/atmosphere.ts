/**
 * The water sheet and the air over it (#559 C, from `terrain/placement.ts`):
 * falling leaves, floating leaves, mist, water lilies, sun shafts and rapids.
 * Categories: leaves, floatingLeaves, mist, waterLilies, sunShafts, rapids.
 */

import { PlacementAnchor, PlacementAux } from './format';
import { eulerFromUp, unit } from './frame';
import { L, canyonWidth, waterWidth, slot, pond, autumn, s, shape, riffle, ds, PI, W, type PlacementRngs } from './row';
import { type PlacementWriter } from './writer';

const SLOT_SHAFT_ROTATION = eulerFromUp(unit(0.1, 1, 0.05));
const OPEN_SHAFT_ROTATION = eulerFromUp(unit(10, 20, 5));

/** 7. LEAVES (falling), from the canopy height but never inside the ground. */
export function placeLeaves(w: PlacementWriter, R: PlacementRngs): void {
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

/** 7.5 FLOATING LEAVES (pond), on the water sheet. */
export function placeFloatingLeaves(w: PlacementWriter, R: PlacementRngs): void {
  if (!pond) return;
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

/** 11. MIST over the water (waterfalls have their own particles). */
export function placeMist(w: PlacementWriter, R: PlacementRngs): void {
  if (L.segmentType === 'waterfall') return;
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

/** 12. WATER LILIES (pond), on the sheet away from the bank. */
export function placeWaterLilies(w: PlacementWriter, R: PlacementRngs): void {
  if (!pond) return;
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

/** 13. SUN SHAFTS, high over the channel (path-relative, never world Y). */
export function placeSunShafts(w: PlacementWriter, R: PlacementRngs): void {
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

/** 14. RAPIDS — whitewater in the corridor. */
export function placeRapids(w: PlacementWriter, R: PlacementRngs): void {
  if (slot || !(L.flowSpeed > 0.8) || pond) return;
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
