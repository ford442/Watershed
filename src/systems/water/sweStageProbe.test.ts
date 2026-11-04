import { afterEach, describe, expect, it } from 'vitest';
import { sampleSweStage, setSweStageWindow } from './sweStageProbe';

/** 4 × 3 cells at 0.5 m; η = column index × 0.1. */
function fields() {
  const width = 4;
  const height = 3;
  const h = new Float32Array(width * height);
  for (let j = 0; j < height; j += 1) for (let i = 0; i < width; i += 1) h[j * width + i] = i * 0.1;
  return { h, width, height, dx: 0.5 };
}

describe('sweStageProbe (#522 A)', () => {
  afterEach(() => setSweStageWindow(null));

  it('is null with no field (SWE off at Low quality)', () => {
    expect(sampleSweStage(0, 0)).toBeNull();
  });

  it('reads η bilinearly at a world point inside the window', () => {
    setSweStageWindow(fields(), 10, -20);
    expect(sampleSweStage(10, -20)).toBeCloseTo(0, 6);
    expect(sampleSweStage(10.5, -19.5)).toBeCloseTo(0.1, 6);
    expect(sampleSweStage(10.75, -19)).toBeCloseTo(0.15, 6);
    expect(sampleSweStage(11.5, -19)).toBeCloseTo(0.3, 6);
  });

  it('is null outside the window, never an edge cell clamped in', () => {
    setSweStageWindow(fields(), 10, -20);
    expect(sampleSweStage(9.9, -19.5)).toBeNull();
    expect(sampleSweStage(11.6, -19.5)).toBeNull();
    expect(sampleSweStage(10.5, -21)).toBeNull();
    expect(sampleSweStage(10.5, -18.9)).toBeNull();
  });
});
