import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, type SegmentFrame } from '../../systems/map/segmentFrames';
import { BAND_ABOVE, BAND_BELOW, DECAL_LIFT, buildTelegraphBuffers, type TelegraphFloor } from './telegraphGeometry';

/** A straight segment down −Z at x = 0, path y falling 1 m per 10 m. */
function straightFrame(index: number, z0: number, length = 100): SegmentFrame {
  const samples: [number, number, number][] = [];
  for (let j = 0; j <= FRAME_SAMPLES; j += 1) {
    const z = z0 - (length * j) / FRAME_SAMPLES;
    samples.push([0, (z - z0) / 10, z]);
  }
  return { index, zStart: z0, zEnd: z0 - length, pathYMin: -length / 10, pathYMax: 0, samples };
}

/** A V canyon: the floor rises 0.5 m per metre from the centreline (floor height 0 at x = 0). */
const vCanyon: TelegraphFloor = { sampleFloorHeight: (x) => Math.abs(x) * 0.5 };

describe('buildTelegraphBuffers (#578 A.2)', () => {
  const frames = [straightFrame(4, 0)];
  const anchor = [0, -5, -50] as const;

  it('puts the decal at the predicted surface, edge to edge where the floor meets it', () => {
    const { decal } = buildTelegraphBuffers({ anchor, radius: 20, reachHeight: 1.5, frames, floorFor: () => vCanyon });
    expect(decal.positions.length).toBeGreaterThan(0);
    expect(decal.index.length).toBeGreaterThan(0);
    for (let i = 0; i < decal.positions.length; i += 3) {
      const x = decal.positions[i]!;
      const z = decal.positions[i + 2]!;
      // The bank reaches 1.5 m of floor height at |x| = 3 on this V.
      expect(Math.abs(Math.abs(x) - 3)).toBeLessThan(1e-4);
      const pathY = z / 10;
      expect(decal.positions[i + 1]).toBeCloseTo(pathY + 1.5 + DECAL_LIFT, 4);
      // Only within the reach.
      expect(Math.abs(z - anchor[2])).toBeLessThanOrEqual(20 + 1e-3);
    }
  });

  it('winds the decal to face up, so a one-sided material hides it from below', () => {
    const { decal } = buildTelegraphBuffers({ anchor, radius: 20, reachHeight: 1.5, frames, floorFor: () => vCanyon });
    const p = decal.positions;
    for (let t = 0; t < decal.index.length; t += 3) {
      const [a, b, c] = [decal.index[t]! * 3, decal.index[t + 1]! * 3, decal.index[t + 2]! * 3];
      const e1 = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
      const e2 = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
      // y of e1 × e2: the face normal's vertical part.
      expect(e1[2]! * e2[0]! - e1[0]! * e2[2]!).toBeGreaterThan(0);
    }
  });

  it('lays the band on both walls from under the line to over it', () => {
    const { band } = buildTelegraphBuffers({ anchor, radius: 20, reachHeight: 1.5, frames, floorFor: () => vCanyon });
    let left = 0;
    let right = 0;
    for (let i = 0; i < band.positions.length; i += 6) {
      const [x0, y0, z0, x1, y1] = band.positions.subarray(i, i + 5);
      const pathY = z0! / 10;
      expect(y0).toBeCloseTo(pathY + 1.5 - BAND_BELOW, 4);
      expect(y1).toBeCloseTo(pathY + 1.5 + BAND_ABOVE, 4);
      // Higher up the V is farther out: the strip lies on the wall, not vertical.
      expect(Math.abs(x1!)).toBeGreaterThan(Math.abs(x0!));
      if (x0! < 0) left += 1;
      else right += 1;
    }
    expect(left).toBeGreaterThan(5);
    expect(right).toBe(left);
  });

  it('draws nothing off the treadmill, past the reach, or where the bank never rises that high', () => {
    const empty = (input: Parameters<typeof buildTelegraphBuffers>[0]) => {
      const out = buildTelegraphBuffers(input);
      return out.band.positions.length + out.decal.positions.length;
    };
    expect(empty({ anchor, radius: 20, reachHeight: 1.5, frames, floorFor: () => null })).toBe(0);
    expect(empty({ anchor: [0, -5, -500], radius: 20, reachHeight: 1.5, frames, floorFor: () => vCanyon })).toBe(0);
    const pond: TelegraphFloor = { sampleFloorHeight: () => 0 };
    expect(empty({ anchor, radius: 20, reachHeight: 1.5, frames, floorFor: () => pond })).toBe(0);
  });

  it('joins consecutive segments into one strip but not across a gap', () => {
    const joined = buildTelegraphBuffers({
      anchor: [0, -10, -100],
      radius: 30,
      reachHeight: 1.5,
      frames: [straightFrame(4, 0), straightFrame(5, -100)],
      floorFor: () => vCanyon,
    });
    const gapped = buildTelegraphBuffers({
      anchor: [0, -10, -100],
      radius: 30,
      reachHeight: 1.5,
      frames: [straightFrame(4, 0), straightFrame(6, -100)],
      floorFor: () => vCanyon,
    });
    expect(gapped.decal.positions.length).toBe(joined.decal.positions.length);
    // The gap costs exactly the one quad that would have bridged it.
    expect(joined.decal.index.length - gapped.decal.index.length).toBe(6);
  });
});
