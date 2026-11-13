/**
 * Vegetation (#559 C, from `terrain/placement.ts`): bank trees with their
 * pinecones (desert flora in the slot), grass, slot waterline grass,
 * wildflowers, ferns, mushrooms, reeds, and the rim tree silhouettes.
 * Categories: trees, pinecones, cactus, desertSage, grass, canyonGrass,
 * wildflowers, ferns, mushrooms, reeds, rimTrees.
 */

import { sampleTile, TerrainBand } from '../terrainTile';
import {
  input,
  L,
  canyonWidth,
  waterWidth,
  half,
  bankStart,
  slot,
  glacier,
  pond,
  autumn,
  s,
  side,
  edge,
  ds,
  bankUnits,
  PI,
  W,
  type PlacementRngs,
} from './row';
import { ANY_GROUND, BANK_ONLY, DRY, SHORE, type PlacementWriter } from './writer';

/** 2. TREES / DESERT FLORA. */
export function placeTrees(w: PlacementWriter, R: PlacementRngs): void {
  if (input.trees) return;
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

/** 4. GRASS (and Foliage, which reads the same list). */
export function placeGrass(w: PlacementWriter, R: PlacementRngs): void {
  if (slot || glacier) return;
  const r = R.grass;
  if (r() > 0.6) {
    const lat = side * (edge + r() * 4);
    const yaw = r();
    if (w.onGround(s, lat, DRY, true)) w.pushGround('grass', s, lat, w.ground, 0.05, 0, yaw, 0, 0.5, 0.5, 0.5);
  }
}

/** 4.1 CANYON GRASS (slot waterline). */
export function placeCanyonGrass(w: PlacementWriter, R: PlacementRngs): void {
  if (!slot) return;
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

/** 4.5 WILDFLOWERS — denser near the waterline, clumped. */
export function placeWildflowers(w: PlacementWriter, R: PlacementRngs): void {
  if (slot || glacier) return;
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

/** 4.6 FERNS — undergrowth between the water and the wall. */
export function placeFerns(w: PlacementWriter, R: PlacementRngs): void {
  if (slot || glacier) return;
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

/** 4.7 MUSHROOMS — forest floor. */
export function placeMushrooms(w: PlacementWriter, R: PlacementRngs): void {
  if (slot || glacier) return;
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

/** 5. REEDS — planted at the waterline. */
export function placeReeds(w: PlacementWriter, R: PlacementRngs): void {
  if (slot || glacier) return;
  const r = R.reeds;
  if (r() > 0.5) {
    const lat = side * (edge + (r() - 0.2) * 1.5);
    const scale = 0.8 + r() * 0.4;
    const yaw = r() * PI * 2;
    if (w.onGround(s, lat, SHORE)) w.pushGround('reeds', s, lat, w.ground, 0.15, 0, yaw, 0, scale, scale, scale);
  }
}

/** Rim tree silhouettes: on the top surface at the rim — the wall shell, or
 * the lip of the slot's own walls (the slot shell sits inside them). Once per
 * segment, after the station walk. */
export function placeRimTrees(w: PlacementWriter, R: PlacementRngs): void {
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
