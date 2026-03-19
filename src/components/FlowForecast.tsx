import React, { useEffect, useMemo } from 'react';
import { FLOW_FORECAST_STATES, type FlowForecastState } from '../constants/game';

export type FlowForecastSample = {
  hour: number;
  flowRate: number;
  state: FlowForecastState;
};

type FlowForecastProps = {
  temperature: number;
  snowpackIndex: number;
  damReleaseSchedule?: Array<{ hour: number; release: number }>;
  startHour?: number;
  horizonHours?: number;
  onForecastChange?: (samples: FlowForecastSample[]) => void;
};

function computeFlowRate(hour: number, temperature: number, snowpackIndex: number, damReleaseSchedule: Array<{ hour: number; release: number }>) {
  const diurnal = 0.85 + Math.max(0, temperature - 2) * 0.04;
  const melt = Math.max(0, temperature - 1) * snowpackIndex * 0.06;
  const damRelease = damReleaseSchedule.reduce((total, entry) => {
    return total + (Math.abs(entry.hour - hour) <= 1 ? entry.release : 0);
  }, 0);

  return Math.max(0.25, diurnal + melt + damRelease);
}

function classifyFlow(flowRate: number): FlowForecastState {
  if (flowRate >= 1.35) return FLOW_FORECAST_STATES.FLOODED;
  if (flowRate >= 1.05) return FLOW_FORECAST_STATES.HIGH_FLOW;
  return FLOW_FORECAST_STATES.NORMAL;
}

export default function FlowForecast({
  temperature,
  snowpackIndex,
  damReleaseSchedule = [],
  startHour = 0,
  horizonHours = 24,
  onForecastChange,
}: FlowForecastProps) {
  const samples = useMemo(() => {
    const forecast: FlowForecastSample[] = [];

    for (let offset = 0; offset < horizonHours; offset += 1) {
      const hour = startHour + offset;
      const flowRate = computeFlowRate(hour, temperature, snowpackIndex, damReleaseSchedule);
      forecast.push({
        hour,
        flowRate,
        state: classifyFlow(flowRate),
      });
    }

    return forecast;
  }, [damReleaseSchedule, horizonHours, snowpackIndex, startHour, temperature]);

  useEffect(() => {
    onForecastChange?.(samples);
  }, [onForecastChange, samples]);

  return null;
}
