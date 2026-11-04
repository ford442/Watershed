/** splashSpawnMath — the splash VFX gates and counts as tables (#546 D). */
import {
  CRUISE_BASE_COUNT,
  CRUISE_MAX_COUNT,
  cruiseSplashCount,
  detectWaterContactEdge,
  entryExitSplashCount,
  mistSpawnCount,
  raftSubmergedRatio,
  resolveSplashFrameEvents,
} from './splashSpawnMath';

describe('detectWaterContactEdge', () => {
  it.each([
    [false, false, 'none'],
    [false, true, 'entry'],
    [true, false, 'exit'],
    [true, true, 'none'],
  ] as const)('was %s, is %s → %s', (was, is, edge) => {
    expect(detectWaterContactEdge(was, is)).toBe(edge);
  });
});

describe('cruiseSplashCount', () => {
  it.each([
    // speed, maxVelocity, flow, density, count
    [0.5, 10, 1, 1, 0], // below CRUISE_MIN_SPEED
    [1.0, 10, 1, 1, 0], // at it (strict >)
    [10, 10, 1, 1, CRUISE_MAX_COUNT], // full speed, full flow
    [40, 10, 1, 1, CRUISE_MAX_COUNT], // t clamps at 1
    [10, 10, 0, 1, Math.floor(CRUISE_MAX_COUNT * 0.5)], // still water halves it
    [10, 10, 1, 0.5, Math.floor(CRUISE_MAX_COUNT * 0.5)], // LOD density scales it
    [1.0000001, 10, 1, 1, CRUISE_BASE_COUNT], // just over the gate: the base count
  ])('speed %f / max %f, flow %f, density %f → %i', (speed, max, flow, density, count) => {
    expect(cruiseSplashCount(speed, max, flow, density)).toBe(count);
  });

  it('survives maxVelocity at the minimum speed (no divide by zero)', () => {
    expect(cruiseSplashCount(2, 1, 1, 1)).toBe(CRUISE_MAX_COUNT);
  });
});

describe('mistSpawnCount', () => {
  it.each([
    // isRaft, submerged, speed, flow, density, count
    [false, 1, 10, 1, 1, 0], // runner: never
    [true, 0.5, 10, 1, 1, 0], // not deep enough
    [true, 1, 2, 1, 1, 0], // too slow (strict >)
    [true, 1, 7, 1, 1, 2], // opacity 1 → 2 per unit flow
    [true, 1, 4.5, 2, 1, 2], // opacity 0.5, flow 2
    [true, 1, 7, 1, 0.4, 0], // floor(0.8)
  ])('raft %s, submerged %f, speed %f, flow %f, density %f → %i', (raft, sub, speed, flow, density, count) => {
    expect(mistSpawnCount(raft, sub, speed, flow, density)).toBe(count);
  });
});

describe('resolveSplashFrameEvents', () => {
  it('lets an entry win the frame: no cruise, no foam', () => {
    expect(resolveSplashFrameEvents(false, true, true, 9, 10, 1, 1, 0)).toEqual({
      edge: 'entry',
      entrySplash: true,
      exitSplash: false,
      cruiseCount: 0,
      foamEligible: false,
    });
  });

  it('lets an exit win the frame', () => {
    const events = resolveSplashFrameEvents(true, false, true, 9, 10, 1, 1, 0);
    expect(events.exitSplash).toBe(true);
    expect(events.cruiseCount).toBe(0);
  });

  it('cruises in contact only when the cooldown has run out', () => {
    expect(resolveSplashFrameEvents(true, true, true, 10, 10, 1, 1, 0).cruiseCount).toBe(CRUISE_MAX_COUNT);
    expect(resolveSplashFrameEvents(true, true, true, 10, 10, 1, 1, 0.01).cruiseCount).toBe(0);
    expect(resolveSplashFrameEvents(true, true, false, 10, 10, 1, 1, 0).cruiseCount).toBe(0);
  });

  it('foams in the water above the foam speed', () => {
    expect(resolveSplashFrameEvents(true, true, true, 2.5, 10, 1, 1, 1).foamEligible).toBe(true);
    expect(resolveSplashFrameEvents(true, true, true, 2, 10, 1, 1, 1).foamEligible).toBe(false);
    expect(resolveSplashFrameEvents(false, false, true, 9, 10, 1, 1, 1).foamEligible).toBe(false);
  });
});

describe('raftSubmergedRatio', () => {
  it.each([
    [0.5, 0.5, 1], // centred on the surface: (0.15 / 0.3) + 0.5
    [0.8, 0.5, 0], // a hull height above: clamps at 0
    [-1, 0.5, 1], // deep: clamps at 1
    [0.65, 0.5, 0.5],
  ])('body y %f, water %f → %f', (y, water, ratio) => {
    expect(raftSubmergedRatio(y, water)).toBeCloseTo(ratio, 12);
  });
});

describe('entryExitSplashCount', () => {
  it.each([
    [0, 1, 10],
    [1, 1, 25],
    [1, 0.5, 12],
    [0, 0, 1], // never below one particle
  ])('intensity %f, density %f → %i', (intensity, density, count) => {
    expect(entryExitSplashCount(intensity, density)).toBe(count);
  });
});
