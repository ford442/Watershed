/**
 * renderScale.ts — the resolution valve (#419 phase C).
 *
 * A **DPR cap** and a **render scale** are two different knobs, and until this
 * module Watershed only had the first. The cap (`dprMax` in
 * `deriveRendererContextOptions`) is a static ceiling: the most pixels a preset
 * will ever ask for. The scale is a valve: a 0.5–1.0 multiplier on that ceiling
 * that moves with measured frame time and trades resolution for headroom while
 * the game runs.
 *
 * Why it exists now: boot-time graphics negotiation (#405) froze `antialias`,
 * `powerPreference`, and the caveat flag for the session, because they are
 * context-creation attributes and changing one means a new WebGL context — i.e.
 * a Canvas remount, i.e. a Rapier teardown mid-run. The visible trade was that
 * `low` no longer turns MSAA off. The honest fix for MSAA cost on a weak machine
 * is to render fewer pixels, not to tear the context down, and that is exactly
 * what this valve does: it moves `dprMax`, which applies live through the R3F
 * `dpr` prop and `renderer.setPixelRatio`.
 *
 * Deliberately NOT in `rendererContextCreationKey()`: the scale is a live knob,
 * so a scale change must never be able to remount the Canvas. Pinned by a test.
 *
 * This module is dependency-free on purpose — `GameState`, `adaptiveQuality`,
 * and `deriveRendererContextOptions` all import it, and none of them may end up
 * in a cycle because of it.
 */

/** Floor of the valve: half the preset's DPR ceiling (a quarter of the pixels). */
export const RENDER_SCALE_MIN = 0.5;

/** Ceiling of the valve: the preset's own `dprMax`, unmodified. */
export const RENDER_SCALE_MAX = 1.0;

/** Granularity. 0.5 → 1.0 in six positions; one step is ~10% of the pixel work. */
export const RENDER_SCALE_STEP = 0.1;

/**
 * Frame time above `targetFrameTimeMs * SLOW_FRAME_RATIO` counts as a slow tick.
 *
 * 1.2 × 16.67 ms = 20 ms = 50 FPS — the *same* line the preset ladder draws at
 * `targetFPS - 10` (`stepAdaptiveQuality`), expressed in frame time. One
 * condition, two stages: resolution gives first, the preset only after.
 */
export const SLOW_FRAME_RATIO = 1.2;

/**
 * Frame time below `targetFrameTimeMs * FAST_FRAME_RATIO` counts as a fast tick.
 *
 * 0.92 × 16.67 ms = 15.3 ms ≈ 65 FPS — the frame-time form of the preset
 * ladder's `targetFPS + 5` upgrade threshold.
 */
export const FAST_FRAME_RATIO = 0.92;

/**
 * Slow ticks (≈seconds) before the valve closes one step.
 *
 * Shorter than the preset ladder's 3, on purpose: dropping resolution is the
 * cheap, reversible trade and should be reached for first. Stepping a preset
 * changes shadow filtering and map size — a change of *look*, which should stay
 * rare and slow.
 */
export const SCALE_DOWN_TICKS = 2;

/**
 * Fast ticks before the valve opens one step.
 *
 * Longer than the close, and longer than the preset ladder's 2: giving pixels
 * back is what re-loads the GPU, so an over-eager open is how a valve starts
 * oscillating. Asymmetric hysteresis is the standard defence.
 */
export const SCALE_UP_TICKS = 3;

/** Frame-time budget for a target frame rate, in milliseconds. */
export function frameTimeBudgetMs(targetFPS: number): number {
  if (!Number.isFinite(targetFPS) || targetFPS <= 0) return 1000 / 60;
  return 1000 / targetFPS;
}

/**
 * Quantize to `RENDER_SCALE_STEP` and clamp into [MIN, MAX].
 *
 * Also the sanitizer for anything that crosses a store boundary: a NaN, an
 * `undefined` coerced to a number, or a hand-edited value can never put the
 * Canvas on a nonsense DPR.
 */
export function clampRenderScale(value: number): number {
  if (!Number.isFinite(value)) return RENDER_SCALE_MAX;
  const stepped = Math.round(value / RENDER_SCALE_STEP) * RENDER_SCALE_STEP;
  const clamped = Math.min(RENDER_SCALE_MAX, Math.max(RENDER_SCALE_MIN, stepped));
  // 1 - 0.1 is 0.8999999999999999 in binary floating point; the store, the
  // Canvas `dpr` prop, and the debug read-out all want 0.9.
  return Math.round(clamped * 1000) / 1000;
}

/** True when the valve is fully closed — the preset ladder's cue to step down. */
export function isRenderScaleAtFloor(scale: number): boolean {
  return clampRenderScale(scale) <= RENDER_SCALE_MIN;
}

/** True when the valve is fully open — the preset ladder's cue that it may step up. */
export function isRenderScaleAtCeiling(scale: number): boolean {
  return clampRenderScale(scale) >= RENDER_SCALE_MAX;
}

export interface RenderScaleStepInput {
  /** Current scale. Sanitized on the way in, so a drifted value self-corrects. */
  renderScale: number;
  /** Mean frame time over the sampling window, in milliseconds. */
  frameTimeMs: number;
  /** Frame-time budget, in milliseconds — `frameTimeBudgetMs(targetFPS)`. */
  targetFrameTimeMs: number;
  consecutiveSlowTicks: number;
  consecutiveFastTicks: number;
}

export interface RenderScaleStepResult {
  /** `null` when the valve should not move this tick. */
  nextRenderScale: number | null;
  consecutiveSlowTicks: number;
  consecutiveFastTicks: number;
}

function hold(
  consecutiveSlowTicks: number,
  consecutiveFastTicks: number
): RenderScaleStepResult {
  return {
    nextRenderScale: null,
    // Decay rather than reset: one good second inside a bad stretch should not
    // erase the evidence, the same way `stepAdaptiveQuality` decays its own.
    consecutiveSlowTicks: Math.max(0, consecutiveSlowTicks - 1),
    consecutiveFastTicks: Math.max(0, consecutiveFastTicks - 1),
  };
}

/**
 * Pure valve step — exported for unit tests, called once per sampling tick
 * (~1 s) by `LODManager`.
 *
 * Returns `nextRenderScale: null` when nothing should change.
 */
export function stepRenderScale(input: RenderScaleStepInput): RenderScaleStepResult {
  const {
    frameTimeMs,
    targetFrameTimeMs,
    consecutiveSlowTicks,
    consecutiveFastTicks,
  } = input;

  const scale = clampRenderScale(input.renderScale);

  // A missing or nonsensical measurement is not evidence of anything.
  if (
    !Number.isFinite(frameTimeMs) ||
    frameTimeMs <= 0 ||
    !Number.isFinite(targetFrameTimeMs) ||
    targetFrameTimeMs <= 0
  ) {
    return hold(consecutiveSlowTicks, consecutiveFastTicks);
  }

  const slow = frameTimeMs > targetFrameTimeMs * SLOW_FRAME_RATIO;
  const fast = frameTimeMs < targetFrameTimeMs * FAST_FRAME_RATIO;

  if (slow) {
    // Already fully closed — hand the problem to the preset ladder and stop
    // counting, so the valve starts clean if it ever opens again.
    if (isRenderScaleAtFloor(scale)) {
      return { nextRenderScale: null, consecutiveSlowTicks: 0, consecutiveFastTicks: 0 };
    }
    const nextSlow = consecutiveSlowTicks + 1;
    if (nextSlow >= SCALE_DOWN_TICKS) {
      return {
        nextRenderScale: clampRenderScale(scale - RENDER_SCALE_STEP),
        consecutiveSlowTicks: 0,
        consecutiveFastTicks: 0,
      };
    }
    return { nextRenderScale: null, consecutiveSlowTicks: nextSlow, consecutiveFastTicks: 0 };
  }

  if (fast) {
    if (isRenderScaleAtCeiling(scale)) {
      return { nextRenderScale: null, consecutiveSlowTicks: 0, consecutiveFastTicks: 0 };
    }
    const nextFast = consecutiveFastTicks + 1;
    if (nextFast >= SCALE_UP_TICKS) {
      return {
        nextRenderScale: clampRenderScale(scale + RENDER_SCALE_STEP),
        consecutiveSlowTicks: 0,
        consecutiveFastTicks: 0,
      };
    }
    return { nextRenderScale: null, consecutiveSlowTicks: 0, consecutiveFastTicks: nextFast };
  }

  return hold(consecutiveSlowTicks, consecutiveFastTicks);
}
