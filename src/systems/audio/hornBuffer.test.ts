import { describe, expect, it } from 'vitest';
import { HORN_SECONDS, fillHornChannel, hornLength } from './hornBuffer';

const RATE = 8000;

describe('hornBuffer (#578 A.2)', () => {
  const out = new Float32Array(hornLength(RATE));
  fillHornChannel(out, RATE);

  it('is HORN_SECONDS long, peak-normalized, and silent at both ends', () => {
    expect(out.length).toBe(Math.floor(RATE * HORN_SECONDS));
    const peak = Math.max(...Array.from(out, Math.abs));
    expect(peak).toBeCloseTo(0.9, 5);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(0);
  });

  it('is two blasts with a silent gap between them', () => {
    const rms = (from: number, to: number) => {
      let sum = 0;
      for (let i = Math.floor(from * RATE); i < Math.floor(to * RATE); i += 1) sum += out[i] * out[i];
      return Math.sqrt(sum / ((to - from) * RATE));
    };
    expect(rms(0.3, 1.2)).toBeGreaterThan(0.2);
    expect(rms(1.5, 1.8)).toBe(0);
    expect(rms(2.1, 3.0)).toBeGreaterThan(0.2);
  });

  it('a detuned channel differs (two channels decorrelate)', () => {
    const other = new Float32Array(out.length);
    fillHornChannel(other, RATE, 0.004);
    let diff = 0;
    for (let i = 0; i < out.length; i += 1) diff = Math.max(diff, Math.abs(out[i] - other[i]));
    expect(diff).toBeGreaterThan(0.1);
  });
});
