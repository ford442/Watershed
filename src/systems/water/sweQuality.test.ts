import {
  SWE_BUDGETS,
  sweBudgetForQuality,
  sweCellCount,
  sweStepInterval,
} from './sweQuality';
import {
  injectSWEDisturbance,
  consumeSWEDisturbances,
  setSWEActiveBudget,
} from './SWEHeightField';
import type { QualityPreset } from '../GameState';

const PRESETS: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

describe('sweBudgetForQuality', () => {
  it('turns the SWE visual path off entirely on the low preset', () => {
    const budget = sweBudgetForQuality('low');
    expect(budget.enabled).toBe(false);
    expect(sweCellCount(budget)).toBe(0);
    expect(budget.displacementScale).toBe(0);
  });

  it('keeps the high preset on the historical 48x32 / 0.5m grid', () => {
    expect(sweBudgetForQuality('high')).toMatchObject({
      enabled: true,
      width: 48,
      height: 32,
      cellSize: 0.5,
      stepHz: 60,
    });
  });

  it('scales cost monotonically with the preset', () => {
    const cost = (q: QualityPreset) => {
      const b = sweBudgetForQuality(q);
      return sweCellCount(b) * b.stepHz;
    };
    expect(cost('low')).toBe(0);
    expect(cost('medium')).toBeLessThan(cost('high'));
    expect(cost('high')).toBeLessThanOrEqual(cost('ultra'));
  });

  it('covers a comparable slice of river at every enabled preset', () => {
    for (const q of PRESETS) {
      const b = sweBudgetForQuality(q);
      if (!b.enabled) continue;
      expect(b.width * b.cellSize).toBeGreaterThanOrEqual(20);
      expect(b.height * b.cellSize).toBeGreaterThanOrEqual(15);
    }
  });

  it('defines a budget for every quality preset', () => {
    for (const q of PRESETS) {
      expect(SWE_BUDGETS[q]).toBeDefined();
    }
  });
});

describe('sweStepInterval', () => {
  it('is the reciprocal of the step rate, and 0 when disabled', () => {
    expect(sweStepInterval(sweBudgetForQuality('medium'))).toBeCloseTo(1 / 30, 6);
    expect(sweStepInterval(sweBudgetForQuality('high'))).toBeCloseTo(1 / 60, 6);
    expect(sweStepInterval(sweBudgetForQuality('low'))).toBe(0);
  });
});

describe('disturbance gating', () => {
  afterEach(() => {
    setSWEActiveBudget(sweBudgetForQuality('high'));
    consumeSWEDisturbances();
  });

  it('drops splash disturbances while the budget is disabled', () => {
    setSWEActiveBudget(sweBudgetForQuality('low'));
    injectSWEDisturbance(1, 2);
    injectSWEDisturbance(3, 4);
    expect(consumeSWEDisturbances()).toHaveLength(0);
  });

  it('queues them again once an enabled budget is active', () => {
    setSWEActiveBudget(sweBudgetForQuality('high'));
    injectSWEDisturbance(1, 2, 1.5, 0.4);
    const batch = consumeSWEDisturbances();
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ worldX: 1, worldZ: 2, radius: 1.5, amplitude: 0.4 });
  });

  it('clears the queue when the budget is switched off mid-session', () => {
    setSWEActiveBudget(sweBudgetForQuality('high'));
    injectSWEDisturbance(0, 0);
    setSWEActiveBudget(sweBudgetForQuality('low'));
    expect(consumeSWEDisturbances()).toHaveLength(0);
  });

  it('caps the queue so a stalled consumer cannot grow it forever', () => {
    setSWEActiveBudget(sweBudgetForQuality('high'));
    for (let i = 0; i < 500; i += 1) injectSWEDisturbance(i, i);
    expect(consumeSWEDisturbances().length).toBeLessThanOrEqual(64);
  });
});
