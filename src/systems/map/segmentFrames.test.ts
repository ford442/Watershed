import { afterEach, describe, expect, it } from 'vitest';
import {
  FRAME_SAMPLES,
  buildSegmentFrame,
  clearSegmentFrames,
  findSegmentFrameAtZ,
  getSegmentFrame,
  getSegmentFramesVersion,
  publishSegmentFrames,
  resolveSegmentAnchor,
  resolveSegmentEnvelope,
  subscribeSegmentFrames,
  type CurveLike,
} from './segmentFrames';

const FALLBACK = { yMin: -80, yMax: 250 };

/** Straight line from `a` to `b` — stands in for a segment's Catmull-Rom path. */
function line(a: [number, number, number], b: [number, number, number]): CurveLike {
  return {
    getPoint: (t) => ({
      x: a[0] + (b[0] - a[0]) * t,
      y: a[1] + (b[1] - a[1]) * t,
      z: a[2] + (b[2] - a[2]) * t,
    }),
  };
}

afterEach(() => clearSegmentFrames());

describe('buildSegmentFrame', () => {
  it('records the centreline y range and z span', () => {
    const frame = buildSegmentFrame(4, line([0, -300, -100], [0, -350, -150]));
    expect(frame.samples).toHaveLength(FRAME_SAMPLES + 1);
    expect(frame.pathYMax).toBeCloseTo(-300);
    expect(frame.pathYMin).toBeCloseTo(-350);
    expect(frame.zStart).toBeCloseTo(-100);
    expect(frame.zEnd).toBeCloseTo(-150);
    expect(frame.safeZone).toBeUndefined();
  });
});

describe('findSegmentFrameAtZ', () => {
  const frames = [
    buildSegmentFrame(0, line([0, 0, 0], [0, -10, -50])),
    buildSegmentFrame(1, line([0, -10, -50], [0, -20, -100])),
  ];

  it('returns the segment whose z span contains the point', () => {
    expect(findSegmentFrameAtZ(frames, -20)?.index).toBe(0);
    expect(findSegmentFrameAtZ(frames, -75)?.index).toBe(1);
  });

  it('falls back to the nearest segment outside every span', () => {
    expect(findSegmentFrameAtZ(frames, 30)?.index).toBe(0);
    expect(findSegmentFrameAtZ(frames, -400)?.index).toBe(1);
    expect(findSegmentFrameAtZ([], 0)).toBeNull();
  });
});

describe('resolveSegmentEnvelope', () => {
  it('is the absolute fallback before any segment is published (boot)', () => {
    expect(resolveSegmentEnvelope([], { z: -10 }, FALLBACK)).toEqual({
      yMin: -80,
      yMax: 250,
      segmentIndex: null,
      authored: false,
    });
  });

  it('anchors the fallback margins to the segment centreline, not world zero', () => {
    // Deep in a descending map: the old absolute `y < -80` clip fired here.
    const frames = [buildSegmentFrame(9, line([0, -500, -800], [0, -540, -850]))];
    const envelope = resolveSegmentEnvelope(frames, { z: -820 }, FALLBACK);
    expect(envelope.segmentIndex).toBe(9);
    expect(envelope.authored).toBe(false);
    expect(envelope.yMin).toBeCloseTo(-540 - 80);
    expect(envelope.yMax).toBeCloseTo(-500 + 250);
  });

  it('applies an authored safeZone relative to the segment and carries respawnAt', () => {
    const frames = [
      buildSegmentFrame(14, line([0, -800, -1300], [0, -900, -1310]), {
        yMin: -20,
        yMax: 150,
        respawnAt: 13,
      }),
    ];
    const envelope = resolveSegmentEnvelope(frames, { z: -1305 }, FALLBACK);
    expect(envelope).toMatchObject({ segmentIndex: 14, authored: true, respawnAt: 13 });
    expect(envelope.yMin).toBeCloseTo(-920);
    expect(envelope.yMax).toBeCloseTo(-650);
  });

  it('keeps the upstream lip under the ceiling when a launched runner overshoots in z', () => {
    const frames = [
      // Waterfall: 100 m drop over 10 m of z.
      buildSegmentFrame(14, line([0, -800, -1300], [0, -900, -1310])),
      buildSegmentFrame(15, line([0, -900, -1310], [0, -920, -1360]), { yMin: -12, yMax: 20 }),
    ];
    // Still at lip height, already inside the splash pool's z span.
    const envelope = resolveSegmentEnvelope(frames, { z: -1330 }, FALLBACK);
    expect(envelope.segmentIndex).toBe(15);
    expect(-805).toBeLessThan(envelope.yMax);
  });
});

describe('resolveSegmentAnchor', () => {
  const frame = buildSegmentFrame(2, line([10, -40, -100], [10, -60, -200]));

  it('places t along the path and lateral to the right of downstream (+x facing −z)', () => {
    const [x, y, z] = resolveSegmentAnchor(frame, { t: 0.5, lateral: 7, rise: 1.5 });
    expect(x).toBeCloseTo(17);
    expect(y).toBeCloseTo(-50 + 1.5);
    expect(z).toBeCloseTo(-150);
  });

  it('puts a negative lateral on the left bank', () => {
    const [x] = resolveSegmentAnchor(frame, { t: 0, lateral: -9 });
    expect(x).toBeCloseTo(1);
  });

  it('still has a horizontal right vector on a near-vertical waterfall', () => {
    const fall = buildSegmentFrame(12, line([0, 0, 0], [0, -100, -10]));
    const [x, , z] = resolveSegmentAnchor(fall, { t: 0.02, lateral: 9 });
    expect(x).toBeCloseTo(9);
    expect(Number.isFinite(z)).toBe(true);
  });
});

describe('segment frame registry', () => {
  it('publishes, looks up and notifies subscribers', () => {
    let calls = 0;
    const unsubscribe = subscribeSegmentFrames(() => {
      calls += 1;
    });
    const before = getSegmentFramesVersion();
    publishSegmentFrames([buildSegmentFrame(3, line([0, 0, 0], [0, -5, -40]))]);
    expect(getSegmentFrame(3)?.index).toBe(3);
    expect(getSegmentFrame(4)).toBeNull();
    expect(getSegmentFramesVersion()).toBe(before + 1);
    expect(calls).toBe(1);
    unsubscribe();
    clearSegmentFrames();
    expect(calls).toBe(1);
    expect(getSegmentFrame(3)).toBeNull();
  });
});
