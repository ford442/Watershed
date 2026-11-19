/**
 * Glacial ice (#559 C, from `terrain/placement.ts`): icicles hanging from the
 * tube crown or off the open wall, and ice shelves at the waterline.
 * Categories: icicles, iceSheets.
 */

import { bandBit, sampleTile, TerrainBand, TileBranch } from '../terrainTile';
import { PlacementAnchor } from './format';
import { bankStart, glacier, tube, s, flowYaw, side, edge, PI, W, type PlacementRngs } from './row';
import { DRY, type PlacementWriter } from './writer';

/** 16. GLACIAL — icicles hanging from the tube crown, or off the open wall. */
export function placeIcicles(w: PlacementWriter, R: PlacementRngs): void {
  if (!glacier) return;
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

/** 17. GLACIAL — ice shelves at the waterline, on the sheet. */
export function placeIceSheets(w: PlacementWriter, R: PlacementRngs): void {
  if (!glacier) return;
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
