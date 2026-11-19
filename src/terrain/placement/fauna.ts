/**
 * Fauna (#559 C, from `terrain/placement.ts`): fireflies, birds and the bats
 * that roost with them, pond fish, dragonflies, and the slot / autumn bat
 * roost. Categories: fireflies, birds, bats, fish, dragonflies.
 */

import { sampleTile } from '../terrainTile';
import { PlacementAnchor } from './format';
import {
  L,
  canyonWidth,
  waterWidth,
  bankStart,
  slot,
  pond,
  autumn,
  s,
  side,
  edge,
  ds,
  PI,
  W,
  type PlacementRngs,
} from './row';
import { type PlacementWriter } from './writer';

/** 8. FIREFLIES — 1–4 m over the ground or water. */
export function placeFireflies(w: PlacementWriter, R: PlacementRngs): void {
  const r = R.fireflies;
  if (r() > 0.8) {
    const lat = (r() - 0.5) * canyonWidth * 0.9;
    const y = w.groundOrWater(s, lat) + 1.0 + r() * 3.0;
    w.pushAt('fireflies', PlacementAnchor.AIR, s, lat, y, 0, 0, 0, 1, 1, 1);
  }
}

/** 9. BIRDS (and the bats that roost with them). */
export function placeBirds(w: PlacementWriter, R: PlacementRngs): void {
  if (side !== 1 || !(w.count('birds') < 8)) return;
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

/** 10. FISH (pond), under the sheet and above the bed. */
export function placeFish(w: PlacementWriter, R: PlacementRngs): void {
  if (slot || !pond) return;
  const r = R.fish;
  if (r() > 0.6) {
    const lat = (r() - 0.5) * waterWidth * 0.8;
    const yaw = r() * PI * 2;
    const g = sampleTile(w.floor, s, lat, w.ground);
    const y = Math.min(W - 0.1, Math.max(W - 0.5, g.ok ? g.y + 0.15 : W - 0.5));
    w.pushAt('fish', PlacementAnchor.WATER, s, lat, y, 0, yaw, 0, 1, 1, 1);
  }
}

/** 15. DRAGONFLIES — 1–3 m over the bank or the water. */
export function placeDragonflies(w: PlacementWriter, R: PlacementRngs): void {
  if (slot || autumn || L.segmentType === 'waterfall') return;
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

/** Bats: slot and autumn canyons always roost a few. Once per segment, after
 * the station walk. */
export function placeBatRoost(w: PlacementWriter, R: PlacementRngs): void {
  if (!slot && !autumn) return;
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
