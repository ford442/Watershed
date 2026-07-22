import { describe, expect, it } from 'vitest';
import { FLOW_FORECAST_STATES } from '../../constants/game';
import {
  applyForecastToSegmentParams,
  buildForecastSamples,
  bumpRockDensity,
  classifyFlow,
  computeFlowRate,
  FLOW_RATE_THRESHOLDS,
  getForecastEffects,
  nextDamReleaseCountdown,
  resolveForecastState,
  samplesToForecastByIndex,
  upcomingRiskStrip,
} from '../flowForecast';

const BASE_PARAMS = {
  type: 'normal' as const,
  width: 40,
  waterWidth: 20,
  flowSpeed: 1,
  particleCount: 100,
  rockDensity: 'low' as const,
  cameraShake: 0,
};

describe('computeFlowRate / classifyFlow', () => {
  it('is deterministic for fixed inputs', () => {
    const a = computeFlowRate(6, 8, 0.65, [{ hour: 6, release: 0.08 }]);
    const b = computeFlowRate(6, 8, 0.65, [{ hour: 6, release: 0.08 }]);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(1);
  });

  it('raises flow near dam releases and with hotter melt', () => {
    const calm = computeFlowRate(3, 2, 0.2, []);
    const dam = computeFlowRate(6, 2, 0.2, [{ hour: 6, release: 0.5 }]);
    const melt = computeFlowRate(3, 12, 1.0, []);
    expect(dam).toBeGreaterThan(calm);
    expect(melt).toBeGreaterThan(calm);
  });

  it('classifies thresholds including WashedOut', () => {
    expect(classifyFlow(0.9)).toBe(FLOW_FORECAST_STATES.NORMAL);
    expect(classifyFlow(FLOW_RATE_THRESHOLDS.HIGH_FLOW)).toBe(FLOW_FORECAST_STATES.HIGH_FLOW);
    expect(classifyFlow(FLOW_RATE_THRESHOLDS.FLOODED)).toBe(FLOW_FORECAST_STATES.FLOODED);
    expect(classifyFlow(FLOW_RATE_THRESHOLDS.WASHED_OUT)).toBe(FLOW_FORECAST_STATES.WASHED_OUT);
  });
});

describe('buildForecastSamples', () => {
  it('changing inputs changes downstream segment states deterministically', () => {
    const calm = buildForecastSamples({
      temperature: 1,
      snowpackIndex: 0.1,
      damReleaseSchedule: [],
      startHour: 0,
      horizonHours: 8,
    });
    const flood = buildForecastSamples({
      temperature: 18,
      snowpackIndex: 1.2,
      damReleaseSchedule: [
        { hour: 2, release: 0.8 },
        { hour: 3, release: 0.9 },
      ],
      startHour: 0,
      horizonHours: 8,
    });

    expect(calm.every((s) => s.state === FLOW_FORECAST_STATES.NORMAL)).toBe(true);
    expect(flood.some((s) => s.state === FLOW_FORECAST_STATES.FLOODED || s.state === FLOW_FORECAST_STATES.WASHED_OUT)).toBe(
      true,
    );

    const again = buildForecastSamples({
      temperature: 18,
      snowpackIndex: 1.2,
      damReleaseSchedule: [
        { hour: 2, release: 0.8 },
        { hour: 3, release: 0.9 },
      ],
      startHour: 0,
      horizonHours: 8,
    });
    expect(again).toEqual(flood);
  });

  it('maps samples to forecast-by-index states', () => {
    const samples = buildForecastSamples({
      temperature: 18,
      snowpackIndex: 1.2,
      damReleaseSchedule: [{ hour: 0, release: 1.0 }],
      horizonHours: 4,
    });
    const map = samplesToForecastByIndex(samples);
    expect(map.get(0)).toBe(samples[0].state);
    expect(resolveForecastState(map, 0)).toBe(samples[0].state);
    expect(resolveForecastState(undefined, 99)).toBe(FLOW_FORECAST_STATES.NORMAL);
  });
});

describe('applyForecastToSegmentParams', () => {
  it('leaves Normal params unchanged aside from segmentState', () => {
    const applied = applyForecastToSegmentParams(BASE_PARAMS, FLOW_FORECAST_STATES.NORMAL);
    expect(applied.width).toBe(40);
    expect(applied.flowSpeed).toBe(1);
    expect(applied.particleCount).toBe(100);
    expect(applied.rockDensity).toBe('low');
    expect(applied.type).toBe('normal');
    expect(applied.segmentState).toBe(FLOW_FORECAST_STATES.NORMAL);
    expect(applied.washedOutGap).toBe(false);
    expect(applied.surviveBonus).toBe(0);
  });

  it('applies HighFlow / Flooded multipliers and Flooded type override', () => {
    const high = applyForecastToSegmentParams(BASE_PARAMS, FLOW_FORECAST_STATES.HIGH_FLOW);
    expect(high.flowSpeed).toBeCloseTo(1.2);
    expect(high.width).toBeCloseTo(44.8);
    expect(high.particleCount).toBe(140);
    expect(high.rockDensity).toBe('medium');
    expect(high.type).toBe('normal');
    expect(high.surviveBonus).toBe(150);

    const flooded = applyForecastToSegmentParams(BASE_PARAMS, FLOW_FORECAST_STATES.FLOODED);
    expect(flooded.flowSpeed).toBeCloseTo(1.45);
    expect(flooded.width).toBeCloseTo(52);
    expect(flooded.waterWidth).toBeCloseTo(28);
    expect(flooded.particleCount).toBe(200);
    expect(flooded.type).toBe('pond');
    expect(flooded.wallFrictionMult).toBeLessThan(1);
    expect(flooded.slipperinessAdd).toBeGreaterThan(0);
    expect(flooded.surviveBonus).toBe(400);
  });

  it('does not override non-normal types on Flooded', () => {
    const applied = applyForecastToSegmentParams(
      { ...BASE_PARAMS, type: 'waterfall' },
      FLOW_FORECAST_STATES.FLOODED,
    );
    expect(applied.type).toBe('waterfall');
  });

  it('flags washed-out gaps and bumps density further', () => {
    const washed = applyForecastToSegmentParams(
      { ...BASE_PARAMS, hasBridge: true },
      FLOW_FORECAST_STATES.WASHED_OUT,
    );
    expect(washed.segmentState).toBe(FLOW_FORECAST_STATES.WASHED_OUT);
    expect(washed.washedOutGap).toBe(true);
    expect(washed.rockDensity).toBe('high');
    expect(washed.flowSpeed).toBeCloseTo(1.7);
    expect(washed.surviveBonus).toBe(750);
  });

  it('ChunkManager and ReachNormalizer stay in sync for the same inputs', () => {
    const state = FLOW_FORECAST_STATES.FLOODED;
    const mapPath = applyForecastToSegmentParams(BASE_PARAMS, state);
    const reachPath = applyForecastToSegmentParams(
      {
        type: 'normal',
        width: 40,
        waterWidth: 20,
        flowSpeed: 1,
        particleCount: 100,
        rockDensity: 'low',
        cameraShake: 0,
      },
      state,
    );
    expect(mapPath).toEqual(reachPath);
    expect(getForecastEffects(state).flowSpeedMult).toBe(1.45);
  });
});

describe('helpers', () => {
  it('bumps rock density tiers without overflowing', () => {
    expect(bumpRockDensity('low', 1)).toBe('medium');
    expect(bumpRockDensity('medium', 1)).toBe('high');
    expect(bumpRockDensity('high', 2)).toBe('high');
  });

  it('computes dam-release countdown and risk strip', () => {
    const countdown = nextDamReleaseCountdown(
      [
        { hour: 6, release: 0.08 },
        { hour: 14, release: 0.12 },
      ],
      4,
    );
    expect(countdown).toEqual({ hour: 6, release: 0.08, hoursUntil: 2 });

    const samples = buildForecastSamples({
      temperature: 8,
      snowpackIndex: 0.65,
      damReleaseSchedule: [{ hour: 6, release: 0.5 }],
      horizonHours: 12,
    });
    expect(upcomingRiskStrip(samples, 4)).toHaveLength(4);
  });
});
