import { afterEach, describe, expect, it } from 'vitest';
import { authoredGapT, buildSegmentFrame, clearSegmentFrames, publishSegmentFrames } from './segmentFrames';
import { AUTO_JUMP_LEAD_M, autoJumpDue, createAutoJumpState } from './autoJump';

/** A straight 100 m segment running downstream (−z) from z0. */
const straight = (z0: number) => ({ getPoint: (t: number) => ({ x: 0, y: 0, z: z0 - 100 * t }) });

describe('authoredGapT', () => {
  it('reads a shelf rock and an open floor; nothing else is a gap', () => {
    expect(authoredGapT({ launchShelf: { rockRef: { localZ: 20 } } })).toBeCloseTo(0.7);
    expect(authoredGapT({ openFloor: true })).toBe(0);
    expect(authoredGapT({})).toBeNull();
    expect(authoredGapT(null)).toBeNull();
  });
});

describe('autoJumpDue (#558 D.1)', () => {
  afterEach(() => clearSegmentFrames());

  it('fires once, just upstream of the take-off', () => {
    publishSegmentFrames([buildSegmentFrame(3, straight(0), null, 0.5)]);
    const state = createAutoJumpState();
    // Take-off at z = −50. 10 m upstream: not yet.
    expect(autoJumpDue(state, 3, 0, -40)).toBe(false);
    expect(autoJumpDue(state, 3, 0, -50 + AUTO_JUMP_LEAD_M - 0.5)).toBe(true);
    // Once per gap.
    expect(autoJumpDue(state, 3, 0, -49.5)).toBe(false);
  });

  it('never fires past the take-off, nor on a segment with no gap', () => {
    publishSegmentFrames([buildSegmentFrame(3, straight(0), null, 0.5), buildSegmentFrame(4, straight(-100))]);
    const state = createAutoJumpState();
    expect(autoJumpDue(state, 3, 0, -52)).toBe(false);
    expect(autoJumpDue(state, 4, 0, -150)).toBe(false);
  });

  it("an open floor's lip is the next segment's start", () => {
    publishSegmentFrames([buildSegmentFrame(6, straight(0)), buildSegmentFrame(7, straight(-100), null, 0)]);
    expect(autoJumpDue(createAutoJumpState(), 6, 0, -98)).toBe(true);
  });
});
