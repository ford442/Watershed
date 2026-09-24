import { describe, expect, it } from 'vitest';
import { seamLoopChannels } from './loopBuffer';

const SR = 8000;

/** Deterministic noise bed wrapped in codec-like silence + edge fades. */
function codecLikeBed(body: number, lead = 200, fadeLen = 300, trail = 500, seed = 1): Float32Array {
  let s = seed;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const out = new Float32Array(lead + fadeLen + body + fadeLen + trail);
  for (let i = 0; i < fadeLen + body + fadeLen; i += 1) {
    const edge = Math.min(1, i / fadeLen, (fadeLen * 2 + body - i) / fadeLen);
    out[lead + i] = (rnd() * 2 - 1) * 0.5 * edge;
  }
  return out;
}

function maxStep(buf: Float32Array): number {
  let m = 0;
  for (let i = 1; i < buf.length; i += 1) m = Math.max(m, Math.abs(buf[i] - buf[i - 1]));
  return m;
}

describe('seamLoopChannels', () => {
  const opts = { crossfadeSeconds: 0.02, headGuard: 300, tailGuard: 300 };

  it('removes codec silence and fades, leaving a full-level body', () => {
    const [out] = seamLoopChannels([codecLikeBed(4000)], SR, opts)!;
    // Body minus the crossfade (0.02 s * 8000), give or take the first/last
    // fade samples that already clear the silence threshold.
    expect(out.length).toBeLessThanOrEqual(4000 - 160);
    expect(out.length).toBeGreaterThan(4000 - 160 - 8);

    // No near-silent run survives at either edge.
    const edgeRms = (a: number, b: number) =>
      Math.sqrt(out.slice(a, b).reduce((e, x) => e + x * x, 0) / (b - a));
    expect(edgeRms(0, 64)).toBeGreaterThan(0.1);
    expect(edgeRms(out.length - 64, out.length)).toBeGreaterThan(0.1);
  });

  it('wraps without a click — the seam is no worse than the interior', () => {
    const [out] = seamLoopChannels([codecLikeBed(4000)], SR, opts)!;
    const seam = Math.abs(out[0] - out[out.length - 1]);
    expect(seam).toBeLessThanOrEqual(maxStep(out));
  });

  it('keeps channels aligned by trimming on the union of signal', () => {
    const left = codecLikeBed(4000, 200);
    const right = codecLikeBed(4000, 200, 300, 500, 99);
    right.fill(0, 0, 260); // right channel starts later — must not shift left
    const [l, r] = seamLoopChannels([left, right], SR, opts)!;
    expect(l.length).toBe(r.length);
  });

  it('declines material too short to seam', () => {
    expect(seamLoopChannels([codecLikeBed(100)], SR, opts)).toBeNull();
    expect(seamLoopChannels([new Float32Array(4096)], SR, opts)).toBeNull();
    expect(seamLoopChannels([], SR, opts)).toBeNull();
  });

  it('does not mutate the decoded input', () => {
    const input = codecLikeBed(4000);
    const copy = input.slice();
    seamLoopChannels([input], SR, opts);
    expect(Array.from(input)).toEqual(Array.from(copy));
  });
});
