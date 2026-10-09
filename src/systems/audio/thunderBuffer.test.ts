import { describe, expect, it } from 'vitest';
import { THUNDER_SECONDS, fillThunderChannel, thunderLength } from './thunderBuffer';

describe('thunderBuffer', () => {
  const rate = 22050;
  const make = (seed?: number) => {
    const out = new Float32Array(thunderLength(rate));
    fillThunderChannel(out, rate, seed);
    return out;
  };

  it('is one clap long, finite, peak-normalized, and ends silent', () => {
    const out = make();
    expect(out.length).toBe(Math.floor(rate * THUNDER_SECONDS));
    let peak = 0;
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeCloseTo(0.95, 5);
    expect(Math.abs(out[out.length - 1])).toBe(0);
  });

  it('opens with the crack and rolls on after it', () => {
    const out = make();
    const rms = (from: number, to: number) => {
      let sum = 0;
      for (let i = Math.floor(from * rate); i < Math.floor(to * rate); i += 1) sum += out[i] * out[i];
      return Math.sqrt(sum / ((to - from) * rate));
    };
    expect(rms(0, 0.1)).toBeGreaterThan(0.05);
    expect(rms(0.5, 2)).toBeGreaterThan(0.02);
    expect(rms(4.2, 4.4)).toBeLessThan(rms(0.5, 2));
  });

  it('is deterministic per seed', () => {
    expect(make(7)).toEqual(make(7));
    expect(make(7)).not.toEqual(make(8));
  });
});
