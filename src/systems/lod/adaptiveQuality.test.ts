import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_LIVE_BAND,
  stepAdaptiveQuality,
} from './adaptiveQuality';

describe('ADAPTIVE_LIVE_BAND', () => {
  it('excludes low so auto-scaling never remounts the Canvas', () => {
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
