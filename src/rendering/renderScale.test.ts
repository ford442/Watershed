import {
  FAST_FRAME_RATIO,
  RENDER_SCALE_MAX,
  RENDER_SCALE_MIN,
  RENDER_SCALE_STEP,
  SCALE_DOWN_TICKS,
  SCALE_UP_TICKS,
  SLOW_FRAME_RATIO,
  clampRenderScale,
  frameTimeBudgetMs,
  isRenderScaleAtCeiling,
  isRenderScaleAtFloor,
  stepRenderScale,
  type RenderScaleStepResult,
} from './renderScale';

const BUDGET = frameTimeBudgetMs(60);
/** Comfortably past the slow line (20 ms ≈ 50 FPS). */
const SLOW_FRAME = BUDGET * SLOW_FRAME_RATIO + 1;
/** Comfortably inside the fast line (≈15.3 ms ≈ 65 FPS). */
const FAST_FRAME = BUDGET * FAST_FRAME_RATIO - 1;

/** Drive the valve for N ticks at one frame time, as LODManager does. */
function run(startScale: number, frameTimeMs: number, ticks: number) {
  let scale = startScale;
  let slow = 0;
  let fast = 0;
  let last: RenderScaleStepResult | null = null;
  for (let i = 0; i < ticks; i += 1) {
    last = stepRenderScale({
      renderScale: scale,
      frameTimeMs,
      targetFrameTimeMs: BUDGET,
      consecutiveSlowTicks: slow,
      consecutiveFastTicks: fast,
    });
    slow = last.consecutiveSlowTicks;
    fast = last.consecutiveFastTicks;
    if (last.nextRenderScale !== null) scale = last.nextRenderScale;
  }
  return { scale, slow, fast, last: last! };
}

describe('clampRenderScale', () => {
  it('quantizes to the valve step without float dust', () => {
    // 1 - 0.1 is 0.8999999999999999 in binary floating point.
    expect(clampRenderScale(RENDER_SCALE_MAX - RENDER_SCALE_STEP)).toBe(0.9);
    expect(clampRenderScale(0.8999999999999999)).toBe(0.9);
    expect(clampRenderScale(0.74)).toBe(0.7);
    expect(clampRenderScale(0.76)).toBe(0.8);
  });

  it('clamps outside the documented 0.5–1.0 band', () => {
    expect(clampRenderScale(2)).toBe(RENDER_SCALE_MAX);
    expect(clampRenderScale(0.1)).toBe(RENDER_SCALE_MIN);
    expect(clampRenderScale(-5)).toBe(RENDER_SCALE_MIN);
  });

  it('treats a non-finite value as "valve wide open", never as a black canvas', () => {
    expect(clampRenderScale(Number.NaN)).toBe(RENDER_SCALE_MAX);
    expect(clampRenderScale(Number.POSITIVE_INFINITY)).toBe(RENDER_SCALE_MAX);
    expect(clampRenderScale(undefined as unknown as number)).toBe(RENDER_SCALE_MAX);
  });
});

describe('frameTimeBudgetMs', () => {
  it('converts a target frame rate into a millisecond budget', () => {
    expect(frameTimeBudgetMs(60)).toBeCloseTo(16.667, 3);
    expect(frameTimeBudgetMs(30)).toBeCloseTo(33.333, 3);
  });

  it('falls back to the 60 FPS budget for a nonsense target', () => {
    expect(frameTimeBudgetMs(0)).toBeCloseTo(16.667, 3);
    expect(frameTimeBudgetMs(Number.NaN)).toBeCloseTo(16.667, 3);
  });
});

describe('stepRenderScale', () => {
  it('holds the valve open on a healthy frame time', () => {
    const { scale } = run(RENDER_SCALE_MAX, BUDGET, 20);
    expect(scale).toBe(RENDER_SCALE_MAX);
  });

  it('closes one step only after sustained slow frames', () => {
    const before = run(RENDER_SCALE_MAX, SLOW_FRAME, SCALE_DOWN_TICKS - 1);
    expect(before.scale).toBe(RENDER_SCALE_MAX);
    expect(before.last.nextRenderScale).toBeNull();

    const after = run(RENDER_SCALE_MAX, SLOW_FRAME, SCALE_DOWN_TICKS);
    expect(after.scale).toBe(0.9);
  });

  it('closes one step at a time, never in a jump', () => {
    const { scale } = run(RENDER_SCALE_MAX, SLOW_FRAME, SCALE_DOWN_TICKS * 2);
    expect(scale).toBe(0.8);
  });

  it('bottoms out at the documented floor and stops counting there', () => {
    const { scale, last } = run(RENDER_SCALE_MAX, SLOW_FRAME, 60);
    expect(scale).toBe(RENDER_SCALE_MIN);
    // At the floor the preset ladder takes over; the valve holds its history at
    // zero so it starts clean if it ever opens again.
    expect(last.nextRenderScale).toBeNull();
    expect(last.consecutiveSlowTicks).toBe(0);
  });

  it('opens one step after sustained fast frames, on a longer fuse than the close', () => {
    expect(SCALE_UP_TICKS).toBeGreaterThan(SCALE_DOWN_TICKS);
    const before = run(RENDER_SCALE_MIN, FAST_FRAME, SCALE_UP_TICKS - 1);
    expect(before.scale).toBe(RENDER_SCALE_MIN);

    const after = run(RENDER_SCALE_MIN, FAST_FRAME, SCALE_UP_TICKS);
    expect(after.scale).toBe(0.6);
  });

  it('climbs back to the ceiling and stays there', () => {
    const { scale } = run(RENDER_SCALE_MIN, FAST_FRAME, 60);
    expect(scale).toBe(RENDER_SCALE_MAX);
  });

  it('does nothing in the dead band between the two thresholds', () => {
    // Between 15.3 ms and 20 ms: fast enough not to give up pixels, not fast
    // enough to buy more. This band is what keeps the valve from oscillating.
    const deadBand = BUDGET * 1.05;
    const { scale, last } = run(0.8, deadBand, 30);
    expect(scale).toBe(0.8);
    expect(last.nextRenderScale).toBeNull();
  });

  it('decays history in the dead band instead of resetting it', () => {
    const oneSlow = stepRenderScale({
      renderScale: RENDER_SCALE_MAX,
      frameTimeMs: SLOW_FRAME,
      targetFrameTimeMs: BUDGET,
      consecutiveSlowTicks: 0,
      consecutiveFastTicks: 0,
    });
    expect(oneSlow.consecutiveSlowTicks).toBe(1);

    const recovered = stepRenderScale({
      renderScale: RENDER_SCALE_MAX,
      frameTimeMs: BUDGET * 1.05,
      targetFrameTimeMs: BUDGET,
      consecutiveSlowTicks: oneSlow.consecutiveSlowTicks,
      consecutiveFastTicks: oneSlow.consecutiveFastTicks,
    });
    expect(recovered.consecutiveSlowTicks).toBe(0);
    expect(recovered.nextRenderScale).toBeNull();
  });

  it('ignores a missing or nonsensical measurement', () => {
    for (const frameTimeMs of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      const step = stepRenderScale({
        renderScale: RENDER_SCALE_MAX,
        frameTimeMs,
        targetFrameTimeMs: BUDGET,
        consecutiveSlowTicks: 1,
        consecutiveFastTicks: 0,
      });
      expect(step.nextRenderScale).toBeNull();
      expect(step.consecutiveSlowTicks).toBe(0);
    }
  });

  it('self-corrects a drifted scale on the way in', () => {
    const step = stepRenderScale({
      renderScale: 3,
      frameTimeMs: SLOW_FRAME,
      targetFrameTimeMs: BUDGET,
      consecutiveSlowTicks: SCALE_DOWN_TICKS - 1,
      consecutiveFastTicks: 0,
    });
    expect(step.nextRenderScale).toBe(0.9);
  });

  it('draws its thresholds on the same lines as the preset ladder', () => {
    // 1.2 x 16.67 ms = 20 ms = 50 FPS = targetFPS - 10.
    expect(BUDGET * SLOW_FRAME_RATIO).toBeCloseTo(1000 / 50, 1);
    // 0.92 x 16.67 ms = 15.3 ms ~ 65 FPS = targetFPS + 5.
    expect(BUDGET * FAST_FRAME_RATIO).toBeCloseTo(1000 / 65, 0);
  });
});

describe('valve position predicates', () => {
  it('reports the floor and ceiling the preset ladder defers to', () => {
    expect(isRenderScaleAtFloor(RENDER_SCALE_MIN)).toBe(true);
    expect(isRenderScaleAtFloor(0.6)).toBe(false);
    expect(isRenderScaleAtCeiling(RENDER_SCALE_MAX)).toBe(true);
    expect(isRenderScaleAtCeiling(0.9)).toBe(false);
  });

  it('treats out-of-band values as the nearest end, not as neither', () => {
    expect(isRenderScaleAtFloor(0.1)).toBe(true);
    expect(isRenderScaleAtCeiling(4)).toBe(true);
  });
});
