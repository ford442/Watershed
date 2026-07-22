import React, { useEffect, useMemo } from 'react';
import {
  buildForecastSamples,
  type DamReleaseEntry,
  type FlowForecastSample,
} from '../systems/flowForecast';

export type { FlowForecastSample, DamReleaseEntry };

type FlowForecastProps = {
  temperature: number;
  snowpackIndex: number;
  damReleaseSchedule?: ReadonlyArray<DamReleaseEntry>;
  startHour?: number;
  horizonHours?: number;
  onForecastChange?: (samples: FlowForecastSample[]) => void;
};

/**
 * Headless forecast driver — computes hourly samples and pushes them to
 * TrackManager / ReachManager via onForecastChange. Rendering lives in ForecastHUD.
 */
export default function FlowForecast({
  temperature,
  snowpackIndex,
  damReleaseSchedule = [],
  startHour = 0,
  horizonHours = 24,
  onForecastChange,
}: FlowForecastProps) {
  const samples = useMemo(
    () =>
      buildForecastSamples({
        temperature,
        snowpackIndex,
        damReleaseSchedule,
        startHour,
        horizonHours,
      }),
    [damReleaseSchedule, horizonHours, snowpackIndex, startHour, temperature],
  );

  useEffect(() => {
    onForecastChange?.(samples);
  }, [onForecastChange, samples]);

  return null;
}
