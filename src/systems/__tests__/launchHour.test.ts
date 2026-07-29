import { describe, expect, it } from 'vitest';
import { FLOW_FORECAST_STATES } from '../../constants/game';
import {
  applyForecastToSegmentParams,
  buildLaunchForecast,
  launchHourScoreMultiplier,
  nextPeakCountdown,
  segmentParamsAtLaunchHour,
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

const FORECAST_OPTIONS = {
  temperature: 8,
  snowpackIndex: 0.65,
  damReleaseSchedule: [
    { hour: 6, release: 0.08 },
    { hour: 14, release: 0.12 },
  ],
} as const;

describe('launch hour determinism', () => {
  it('produces different segment params for different launch hours on the same segment', () => {
    const calmOptions = {
      temperature: 1,
      snowpackIndex: 0.1,
      damReleaseSchedule: [] as const,
    };
    const damOptions = {
      temperature: 1,
      snowpackIndex: 0.1,
      damReleaseSchedule: [{ hour: 14, release: 0.9 }] as const,
    };

    const calmLaunch = segmentParamsAtLaunchHour(BASE_PARAMS, 3, 0, calmOptions);
    const damLaunch = segmentParamsAtLaunchHour(BASE_PARAMS, 14, 0, damOptions);

    expect(calmLaunch).toEqual(
      segmentParamsAtLaunchHour(BASE_PARAMS, 3, 0, calmOptions),
    );
    expect(calmLaunch.flowSpeed).not.toBe(damLaunch.flowSpeed);
    expect(calmLaunch.segmentState).not.toBe(damLaunch.segmentState);
  });

  it('freezes forecast samples from the selected launch hour', () => {
    const samples = buildLaunchForecast({
      ...FORECAST_OPTIONS,
      startHour: 14,
      horizonHours: 8,
    });
    expect(samples[0].hour).toBe(14);
    expect(samples).toEqual(
      buildLaunchForecast({
        ...FORECAST_OPTIONS,
        startHour: 14,
        horizonHours: 8,
      }),
    );
  });

  it('applies harder-hour score multipliers for elevated risk', () => {
    expect(launchHourScoreMultiplier(FLOW_FORECAST_STATES.NORMAL)).toBe(1);
    expect(launchHourScoreMultiplier(FLOW_FORECAST_STATES.HIGH_FLOW)).toBe(1.1);
    expect(launchHourScoreMultiplier(FLOW_FORECAST_STATES.FLOODED)).toBe(1.25);
    expect(launchHourScoreMultiplier(FLOW_FORECAST_STATES.WASHED_OUT)).toBe(1.5);
  });

  it('finds the next peak in the lookahead strip', () => {
    const samples = buildLaunchForecast({
      temperature: 18,
      snowpackIndex: 1.2,
      damReleaseSchedule: [{ hour: 2, release: 0.8 }],
      startHour: 0,
      horizonHours: 8,
    });
    const peak = nextPeakCountdown(samples);
    expect(peak).not.toBeNull();
    expect(peak!.hoursUntil).toBeGreaterThan(0);
    expect(peak!.flowRate).toBeGreaterThan(samples[0].flowRate);
  });

  it('maps washed-out launch hours to bridge gaps', () => {
    const applied = applyForecastToSegmentParams(
      { ...BASE_PARAMS, hasBridge: true },
      FLOW_FORECAST_STATES.WASHED_OUT,
    );
    expect(applied.washedOutGap).toBe(true);
  });
});
