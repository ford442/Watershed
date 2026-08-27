import { describe, expect, it } from 'vitest';
import {
  FALLBACK_FLOW_DIR,
  sampleSWEFlow,
  type SWEFlowGrid,
} from './sampleSWEFlow';
import { SWE_MEAN_DEPTH } from './SWEHeightField';

function makeGrid(opts: {
  width: number;
  height: number;
  cellSize?: number;
  originX?: number;
  originZ?: number;
  h?: number;
  u?: number;
  w?: number;
  b?: number;
}): SWEFlowGrid {
  const width = opts.width;
  const height = opts.height;
  const count = width * height;
  return {
    h: new Float32Array(count).fill(opts.h ?? 0),
    u: new Float32Array(count).fill(opts.u ?? 0),
    w: new Float32Array(count).fill(opts.w ?? 0),
    b: new Float32Array(count).fill(opts.b ?? 0),
    width,
    height,
    cellSize: opts.cellSize ?? 0.5,
    originX: opts.originX ?? 0,
    originZ: opts.originZ ?? 0,
  };
}

function setCell(grid: SWEFlowGrid, i: number, j: number, field: 'h' | 'u' | 'w' | 'b', value: number): void {
  (grid[field] as Float32Array)[j * grid.width + i] = value;
}

describe('sampleSWEFlow', () => {
  it('wet cell with u=1, w=0 → dir (1, 0) and speed min(1, authored cap)', () => {
    const grid = makeGrid({ width: 4, height: 4, u: 1, w: 0 });
    const sample = sampleSWEFlow({
      worldX: 0,
      worldZ: 0,
      flowSpeed: 2.2,
      grid,
    });
    expect(sample.source).toBe('swe');
    expect(sample.wet).toBe(true);
    expect(sample.dirX).toBeCloseTo(1, 5);
    expect(sample.dirZ).toBeCloseTo(0, 5);
    expect(sample.speed).toBeCloseTo(1, 5);
  });

  it('caps wet speed at authored flowSpeed', () => {
    const grid = makeGrid({ width: 4, height: 4, u: 3, w: 0 });
    const sample = sampleSWEFlow({
      worldX: 0,
      worldZ: 0,
      flowSpeed: 1.5,
      grid,
    });
    expect(sample.dirX).toBeCloseTo(1, 5);
    expect(sample.speed).toBeCloseTo(1.5, 5);
  });

  it('dry cell does not pull (speed 0)', () => {
    const grid = makeGrid({
      width: 4,
      height: 4,
      u: 1,
      w: 0,
      b: SWE_MEAN_DEPTH + 2,
    });
    const sample = sampleSWEFlow({
      worldX: 0,
      worldZ: 0,
      flowSpeed: 2.2,
      grid,
    });
    expect(sample.wet).toBe(false);
    expect(sample.speed).toBe(0);
    expect(sample.source).toBe('swe');
  });

  it('cell with zero total depth does not pull', () => {
    const grid = makeGrid({
      width: 2,
      height: 2,
      h: 0,
      b: SWE_MEAN_DEPTH,
      u: 1,
    });
    const sample = sampleSWEFlow({
      worldX: 0,
      worldZ: 0,
      flowSpeed: 4,
      grid,
    });
    expect(sample.wet).toBe(false);
    expect(sample.speed).toBe(0);
  });

  it('tracks the same world point after an origin shift', () => {
    const cellSize = 0.5;
    const gridA = makeGrid({ width: 8, height: 8, cellSize, originX: 0, originZ: 0 });
    setCell(gridA, 2, 1, 'u', 1);
    const worldX = 2 * cellSize;
    const worldZ = 1 * cellSize;
    const before = sampleSWEFlow({ worldX, worldZ, flowSpeed: 4, grid: gridA });
    expect(before.dirX).toBeCloseTo(1, 5);
    expect(before.speed).toBeCloseTo(1, 5);

    const gridB = makeGrid({ width: 8, height: 8, cellSize, originX: cellSize, originZ: 0 });
    setCell(gridB, 1, 1, 'u', 1);
    const after = sampleSWEFlow({ worldX, worldZ, flowSpeed: 4, grid: gridB });
    expect(after.dirX).toBeCloseTo(before.dirX, 5);
    expect(after.dirZ).toBeCloseTo(before.dirZ, 5);
    expect(after.speed).toBeCloseTo(before.speed, 5);
  });

  it('clamps at transmissive edges instead of wrapping', () => {
    const grid = makeGrid({ width: 4, height: 4, originX: 0, originZ: 0, cellSize: 1 });
    setCell(grid, 0, 0, 'u', 1);
    setCell(grid, 3, 3, 'w', 1);
    const outside = sampleSWEFlow({
      worldX: -20,
      worldZ: -20,
      flowSpeed: 4,
      grid,
    });
    expect(outside.dirX).toBeCloseTo(1, 5);
    expect(outside.dirZ).toBeCloseTo(0, 5);
    expect(outside.speed).toBeCloseTo(1, 5);
  });

  it('falls back to (0, −1) * flowSpeed when SWE is disabled', () => {
    const grid = makeGrid({ width: 4, height: 4, u: 1, w: 0 });
    const sample = sampleSWEFlow({
      worldX: 0,
      worldZ: 0,
      flowSpeed: 1.2,
      grid,
      enabled: false,
    });
    expect(sample.source).toBe('fallback');
    expect(sample.dirX).toBe(FALLBACK_FLOW_DIR.x);
    expect(sample.dirZ).toBe(FALLBACK_FLOW_DIR.z);
    expect(sample.speed).toBe(1.2);
  });

  it('falls back when there is no grid', () => {
    const sample = sampleSWEFlow({
      worldX: 0,
      worldZ: 0,
      flowSpeed: 0.8,
      grid: null,
    });
    expect(sample.source).toBe('fallback');
    expect(sample.dirX).toBe(0);
    expect(sample.dirZ).toBe(-1);
    expect(sample.speed).toBe(0.8);
  });

  it('lake-at-rest wet cell has speed 0', () => {
    const grid = makeGrid({ width: 4, height: 4, u: 0, w: 0 });
    const sample = sampleSWEFlow({
      worldX: 0,
      worldZ: 0,
      flowSpeed: 2.2,
      grid,
    });
    expect(sample.wet).toBe(true);
    expect(sample.speed).toBe(0);
    expect(sample.dirZ).toBe(-1);
  });
});
