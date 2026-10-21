import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SegmentBedGrid } from '../../terrain/segmentMeshBuild';
import { EROSION_REFRESH_SECONDS, erosionRate, type ErosionFieldView } from '../../terrain/erosion';
import {
  accumulateFieldErosion,
  flushErosion,
  getSegmentErosion,
  getSegmentErosionVersion,
  registerSegmentErosion,
  resetErosionFieldForTests,
  setErosionStore,
  subscribeSegmentErosion,
  unregisterSegmentErosion,
  type ErosionStore,
} from './erosionField';

/** A 4 × 4 hull grid, 8 m wide, rows from z 0 to z −12 along x 0. */
function bedAt(z0 = 0): SegmentBedGrid {
  const rows = new Float32Array(5 * 3);
  for (let iz = 0; iz <= 4; iz += 1) rows.set([0, -2 - iz, z0 - 3 * iz], iz * 3);
  return { segmentsX: 4, segmentsZ: 4, width: 8, h: new Float32Array(25), rows };
}

/** A window over z ∈ [−20, 4]: 1 m deep everywhere, running −Z at `speed`. */
function field(speed: number): ErosionFieldView {
  const width = 16;
  const height = 25;
  const n = width * height;
  return {
    h: new Float32Array(n),
    u: new Float32Array(n),
    w: new Float32Array(n).fill(-speed),
    b: new Float32Array(n),
    width,
    height,
    cellSize: 1,
    originX: -8,
    originZ: -20,
    stillDepth: 1,
  };
}

function memoryStore(): ErosionStore & { saved: Map<string, Float32Array> } {
  const saved = new Map<string, Float32Array>();
  return {
    saved,
    load: (key, size) => {
      const plane = saved.get(key);
      return plane && plane.length === size ? plane.slice() : null;
    },
    save: (key, plane) => {
      saved.set(key, plane.slice());
    },
  };
}

afterEach(() => resetErosionFieldForTests());

describe('erosionField', () => {
  it('integrates the field under a segment and refreshes it at most once per EROSION_REFRESH_SECONDS', () => {
    registerSegmentErosion(3, bedAt(), null);
    const listener = vi.fn();
    subscribeSegmentErosion(3, listener);
    expect(getSegmentErosionVersion(3)).toBe(0);
    const dt = 1 / 60;
    const bumpsAt: number[] = [];
    for (let step = 1; step <= 60 * 10; step += 1) {
      if (accumulateFieldErosion(field(2), dt) > 0) bumpsAt.push(step * dt);
    }
    expect(bumpsAt.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < bumpsAt.length; i += 1) {
      expect(bumpsAt[i] - bumpsAt[i - 1]).toBeGreaterThanOrEqual(EROSION_REFRESH_SECONDS - 1e-9);
    }
    expect(listener).toHaveBeenCalledTimes(bumpsAt.length);
    const entry = getSegmentErosion(3)!;
    expect(entry.plane[12]).toBeCloseTo(erosionRate(2) * 10, 3);
    // The meshes read `applied`: the plane as of the last bump, not the live one.
    expect(entry.applied[12]).toBeLessThanOrEqual(entry.plane[12]);
  });

  it('still water never asks for a refresh', () => {
    registerSegmentErosion(1, bedAt(), null);
    for (let step = 0; step < 600; step += 1) accumulateFieldErosion(field(0), 1 / 60);
    expect(getSegmentErosionVersion(1)).toBe(0);
    expect(getSegmentErosion(1)!.dirty).toBe(false);
  });

  it('leaves segments outside the window alone', () => {
    registerSegmentErosion(1, bedAt(-200), null);
    for (let step = 0; step < 600; step += 1) accumulateFieldErosion(field(2), 1 / 60);
    expect(getSegmentErosion(1)!.plane.every((v) => v === 0)).toBe(true);
  });

  it('starts from the stored bed and saves a worked one when the segment leaves', () => {
    const store = memoryStore();
    setErosionStore(store);
    const stored = new Float32Array(25).fill(0.05);
    store.saved.set('meander:4', stored);
    const entry = registerSegmentErosion(4, bedAt(), 'meander:4');
    expect(entry.version).toBe(1);
    expect(entry.applied[0]).toBeCloseTo(0.05, 6);

    // Untouched since load: leaving does not rewrite it.
    store.save = vi.fn(store.save);
    unregisterSegmentErosion(4);
    expect(store.save).not.toHaveBeenCalled();

    registerSegmentErosion(4, bedAt(), 'meander:4');
    for (let step = 0; step < 120; step += 1) accumulateFieldErosion(field(2), 1 / 60);
    unregisterSegmentErosion(4);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.saved.get('meander:4')![12]).toBeGreaterThan(0.05);
  });

  it('a grid of another size starts fresh; flush persists without unregistering', () => {
    const store = memoryStore();
    setErosionStore(store);
    store.saved.set('glacial:2', new Float32Array(10).fill(0.1));
    const entry = registerSegmentErosion(2, bedAt(), 'glacial:2');
    expect(entry.plane.every((v) => v === 0)).toBe(true);
    for (let step = 0; step < 60; step += 1) accumulateFieldErosion(field(2), 1 / 60);
    flushErosion();
    expect(store.saved.get('glacial:2')!.length).toBe(25);
    expect(getSegmentErosion(2)!.dirty).toBe(false);
  });
});
