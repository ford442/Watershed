import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_LIVE_BAND,
  stepAdaptiveQuality,
} from './adaptiveQuality';
import { RENDER_SCALE_MAX, RENDER_SCALE_MIN } from '../../rendering/renderScale';

describe('ADAPTIVE_LIVE_BAND', () => {
  it('excludes low so auto-scaling never changes the look for the player', () => {
    expect(ADAPTIVE_LIVE_BAND).toEqual(['medium', 'high', 'ultra']);
    expect(ADAPTIVE_LIVE_BAND).not.toContain('low');
  });
});

describe('stepAdaptiveQuality', () => {
  it('never proposes a change while the user is on low', () => {
    const step = stepAdaptiveQuality({
      quality: 'low',
      currentFPS: 10,
      targetFPS: 60,
      consecutiveLowSeconds: 10,
      consecutiveHighSeconds: 10,
    });
    expect(step.nextQuality).toBeNull();
    expect(step.consecutiveLowSeconds).toBe(0);
    expect(step.consecutiveHighSeconds).toBe(0);
  });

  it('does not auto-downgrade from medium to low after sustained low FPS', () => {
    let lowSeconds = 0;
    let next = null as ReturnType<typeof stepAdaptiveQuality>['nextQuality'];
    for (let i = 0; i < 6; i++) {
      const step = stepAdaptiveQuality({
        quality: 'medium',
        currentFPS: 20,
        targetFPS: 60,
        consecutiveLowSeconds: lowSeconds,
        consecutiveHighSeconds: 0,
      });
      lowSeconds = step.consecutiveLowSeconds;
      next = step.nextQuality;
    }
    expect(next).toBeNull();
  });

  it('downgrades high → medium after three sustained low-FPS samples', () => {
    let lowSeconds = 0;
    let next = null as ReturnType<typeof stepAdaptiveQuality>['nextQuality'];
    for (let i = 0; i < 3; i++) {
      const step = stepAdaptiveQuality({
        quality: 'high',
        currentFPS: 40,
        targetFPS: 60,
        consecutiveLowSeconds: lowSeconds,
        consecutiveHighSeconds: 0,
      });
      lowSeconds = step.consecutiveLowSeconds;
      next = step.nextQuality;
    }
    expect(next).toBe('medium');
  });

  it('upgrades medium → high after two sustained high-FPS samples', () => {
    let highSeconds = 0;
    let next = null as ReturnType<typeof stepAdaptiveQuality>['nextQuality'];
    for (let i = 0; i < 2; i++) {
      const step = stepAdaptiveQuality({
        quality: 'medium',
        currentFPS: 70,
        targetFPS: 60,
        consecutiveLowSeconds: 0,
        consecutiveHighSeconds: highSeconds,
      });
      highSeconds = step.consecutiveHighSeconds;
      next = step.nextQuality;
    }
    expect(next).toBe('high');
  });

  it('decays counters in the stable FPS band', () => {
    const step = stepAdaptiveQuality({
      quality: 'high',
      currentFPS: 60,
      targetFPS: 60,
      consecutiveLowSeconds: 2,
      consecutiveHighSeconds: 1,
    });
    expect(step.nextQuality).toBeNull();
    expect(step.consecutiveLowSeconds).toBe(1);
    expect(step.consecutiveHighSeconds).toBe(0);
  });
});

describe('stepAdaptiveQuality — deferring to the render-scale valve (#419 phase C)', () => {
  /** Run the ladder for N ticks at one FPS reading with a fixed valve position. */
  function run(
    quality: 'medium' | 'high' | 'ultra',
    currentFPS: number,
    renderScale: number,
    ticks: number,
  ) {
    let lowSeconds = 0;
    let highSeconds = 0;
    let next = null as ReturnType<typeof stepAdaptiveQuality>['nextQuality'];
    for (let i = 0; i < ticks; i += 1) {
      const step = stepAdaptiveQuality({
        quality,
        currentFPS,
        targetFPS: 60,
        consecutiveLowSeconds: lowSeconds,
        consecutiveHighSeconds: highSeconds,
        renderScale,
      });
      lowSeconds = step.consecutiveLowSeconds;
      highSeconds = step.consecutiveHighSeconds;
      next = step.nextQuality;
    }
    return next;
  }

  it('holds the preset while the valve still has resolution to give', () => {
    // Resolution is the cheap, reversible trade; the preset changes the look.
    expect(run('high', 40, RENDER_SCALE_MAX, 10)).toBeNull();
    expect(run('high', 40, 0.6, 10)).toBeNull();
  });

  it('steps the preset down once the valve is floored', () => {
    expect(run('high', 40, RENDER_SCALE_MIN, 3)).toBe('medium');
  });

  it('gives the preset its full three seconds after the valve floors, not before', () => {
    expect(run('high', 40, RENDER_SCALE_MIN, 2)).toBeNull();
  });

  it('holds the preset up while the valve is still closed', () => {
    // A machine rendering at 0.7x has not earned a heavier preset — it has
    // earned its pixels back first.
    expect(run('medium', 70, 0.7, 10)).toBeNull();
  });

  it('steps the preset up once the valve is back at its ceiling', () => {
    expect(run('medium', 70, RENDER_SCALE_MAX, 2)).toBe('high');
  });

  it('treats an omitted valve as "no valve in this system", not as a wide-open one', () => {
    // Callers that predate the valve (and the LOD tables) keep the preset-only
    // ladder; a caller that passes 1.0 is stating it has a valve with room.
    const withoutValve = stepAdaptiveQuality({
      quality: 'high',
      currentFPS: 40,
      targetFPS: 60,
      consecutiveLowSeconds: 2,
      consecutiveHighSeconds: 0,
    });
    expect(withoutValve.nextQuality).toBe('medium');

    const withOpenValve = stepAdaptiveQuality({
      quality: 'high',
      currentFPS: 40,
      targetFPS: 60,
      consecutiveLowSeconds: 2,
      consecutiveHighSeconds: 0,
      renderScale: RENDER_SCALE_MAX,
    });
    expect(withOpenValve.nextQuality).toBeNull();
  });

  it('still refuses to auto-select low, valve floored or not', () => {
    expect(run('medium', 20, RENDER_SCALE_MIN, 10)).toBeNull();
  });
});
