/**
 * Slipperiness → Rapier contact friction (survival v2 phase B).
 *
 * These lock the mapping the canyon collision mesh uses. The companion rule —
 * that water-borne lateral drag stays in WaterFlowForces and is NOT re-applied
 * here — is documented in surfaceFriction.ts and enforced by review, not code.
 */

import {
  FORECAST_FRICTION,
  ICE_MIN_FRICTION,
  forecastFrictionOverride,
  resolveSegmentFriction,
  resolveSegmentRestitution,
} from '../surfaceFriction';

const ROCK_FRICTION = 1.0;

describe('resolveSegmentFriction', () => {
  it('returns the biome friction untouched on a normal, non-slippery segment', () => {
    expect(resolveSegmentFriction({ baseFriction: ROCK_FRICTION })).toBe(ROCK_FRICTION);
    expect(
      resolveSegmentFriction({ baseFriction: ROCK_FRICTION, segmentState: 'Normal' }),
    ).toBe(ROCK_FRICTION);
  });

  it('drops toward the ice floor as slipperiness rises', () => {
    const glacier = resolveSegmentFriction({ baseFriction: ROCK_FRICTION, slipperiness: 0.9 });
    expect(glacier).toBeLessThan(0.2);
    expect(glacier).toBeGreaterThan(ICE_MIN_FRICTION);

    const full = resolveSegmentFriction({ baseFriction: ROCK_FRICTION, slipperiness: 1 });
    expect(full).toBeCloseTo(ICE_MIN_FRICTION, 6);
  });

  it('never returns exactly zero friction — Rapier jitters on frictionless contact', () => {
    expect(resolveSegmentFriction({ baseFriction: 0.2, slipperiness: 1 })).toBeGreaterThan(0);
  });

  it('is monotonic: more slipperiness is never more grip', () => {
    let previous = Infinity;
    for (const slip of [0, 0.25, 0.5, 0.75, 1]) {
      const friction = resolveSegmentFriction({ baseFriction: ROCK_FRICTION, slipperiness: slip });
      expect(friction).toBeLessThanOrEqual(previous);
      previous = friction;
    }
  });

  it('applies flood-state friction floors, matching the shipped values', () => {
    expect(resolveSegmentFriction({ baseFriction: ROCK_FRICTION, segmentState: 'WashedOut' }))
      .toBe(FORECAST_FRICTION.WashedOut);
    expect(resolveSegmentFriction({ baseFriction: ROCK_FRICTION, segmentState: 'Flooded' }))
      .toBe(FORECAST_FRICTION.Flooded);
    expect(resolveSegmentFriction({ baseFriction: ROCK_FRICTION, segmentState: 'HighFlow' }))
      .toBe(FORECAST_FRICTION.HighFlow);
  });

  it('lets ice slicken an already-flooded segment, never re-grip it', () => {
    const floodedIce = resolveSegmentFriction({
      baseFriction: ROCK_FRICTION,
      segmentState: 'Flooded',
      slipperiness: 0.8,
    });
    expect(floodedIce).toBeLessThan(FORECAST_FRICTION.Flooded);
  });

  it('does not let a grippy biome undo a flood state', () => {
    const flooded = resolveSegmentFriction({ baseFriction: 2, segmentState: 'Flooded' });
    expect(flooded).toBe(FORECAST_FRICTION.Flooded);
  });

  it('clamps out-of-range and non-finite inputs', () => {
    expect(resolveSegmentFriction({ baseFriction: ROCK_FRICTION, slipperiness: 5 }))
      .toBeCloseTo(ICE_MIN_FRICTION, 6);
    expect(resolveSegmentFriction({ baseFriction: ROCK_FRICTION, slipperiness: -3 }))
      .toBe(ROCK_FRICTION);
    expect(resolveSegmentFriction({ baseFriction: ROCK_FRICTION, slipperiness: NaN }))
      .toBe(ROCK_FRICTION);
    expect(resolveSegmentFriction({ baseFriction: NaN })).toBe(1);
  });
});

describe('forecastFrictionOverride', () => {
  it('is null for normal or unknown states', () => {
    expect(forecastFrictionOverride()).toBeNull();
    expect(forecastFrictionOverride('Normal')).toBeNull();
    expect(forecastFrictionOverride('Wobbly')).toBeNull();
  });
});

describe('resolveSegmentRestitution', () => {
  it('leaves rock restitution alone and nudges ice to skip', () => {
    expect(resolveSegmentRestitution(0.1, 0)).toBe(0.1);
    expect(resolveSegmentRestitution(0.1, 1)).toBeGreaterThan(0.1);
    expect(resolveSegmentRestitution(0.1, 1)).toBeLessThan(0.25);
  });
});
