import { describe, it, expect } from 'vitest';
import {
  SPEED_WIND_LOOP_SECONDS,
  fillSpeedWindChannel,
  speedWindLoopLength,
} from './speedWindBuffer';

function fill(length: number, seed?: number): Float32Array {
  const out = new Float32Array(length);
  fillSpeedWindChannel(out, seed);
  return out;
}

describe('speedWindBuffer', () => {
  it('sizes the loop from the context sample rate', () => {
    expect(speedWindLoopLength(48000)).toBe(48000 * SPEED_WIND_LOOP_SECONDS);
    expect(speedWindLoopLength(0)).toBe(1);
  });

  it('is deterministic for a seed and distinct across seeds', () => {
    expect(Array.from(fill(2048, 7))).toEqual(Array.from(fill(2048, 7)));

    const a = fill(2048, 7);
    const b = fill(2048, 8);
    let identical = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) identical += 1;
    // Decorrelated channels: a handful of coincidences is fine, a copy is not.
    expect(identical).toBeLessThan(a.length * 0.05);
  });

  it('produces finite, headroom-respecting audio', () => {
    const buf = fill(8192);
    let peak = 0;
    let energy = 0;
    for (const sample of buf) {
      expect(Number.isFinite(sample)).toBe(true);
      peak = Math.max(peak, Math.abs(sample));
      energy += sample * sample;
    }
    expect(peak).toBeCloseTo(0.9, 3);
    expect(Math.sqrt(energy / buf.length)).toBeGreaterThan(0.05);
  });

  it('wraps without a click — the seam is no worse than the interior', () => {
    const buf = fill(8192);
    const seam = Math.abs(buf[0] - buf[buf.length - 1]);

    let maxStep = 0;
    for (let i = 1; i < buf.length; i += 1) {
      maxStep = Math.max(maxStep, Math.abs(buf[i] - buf[i - 1]));
    }
    expect(seam).toBeLessThanOrEqual(maxStep);
  });

  it('handles a zero-length channel', () => {
    expect(() => fillSpeedWindChannel(new Float32Array(0))).not.toThrow();
  });
});
