import React, { useMemo } from 'react';
import { FLOW_FORECAST_STATES } from '../constants/game';
import {
  buildForecastSamples,
  classifyFlow,
  type DamReleaseEntry,
  type FlowForecastSample,
} from '../systems/map/flowForecast';
import { useT } from '../i18n/useT';
import { formatFixed, formatLaunchHour } from '../i18n/format';

const STATE_COLORS: Record<string, string> = {
  [FLOW_FORECAST_STATES.NORMAL]: '#89d18b',
  [FLOW_FORECAST_STATES.HIGH_FLOW]: '#f3c969',
  [FLOW_FORECAST_STATES.FLOODED]: '#ff7f6e',
  [FLOW_FORECAST_STATES.WASHED_OUT]: '#c44bff',
};

type LaunchHourPickerProps = {
  value: number;
  onChange: (hour: number) => void;
  temperature?: number;
  snowpackIndex?: number;
  damReleaseSchedule?: ReadonlyArray<DamReleaseEntry>;
};

export default function LaunchHourPicker({
  value,
  onChange,
  temperature = 8,
  snowpackIndex = 0.65,
  damReleaseSchedule = [],
}: LaunchHourPickerProps) {
  const samples = useMemo(
    () =>
      buildForecastSamples({
        temperature,
        snowpackIndex,
        damReleaseSchedule,
        startHour: 0,
        horizonHours: 24,
      }),
    [damReleaseSchedule, snowpackIndex, temperature],
  );

  const t = useT();
  const selected = samples[value] ?? samples[0];

  return (
    <div className="start-menu-launch-hour">
      <div className="start-menu-map-select-label">{t('menu.launchHour')}</div>
      <div className="start-menu-launch-hour-value">
        {t('menu.launchHour.value', {
          hour: formatLaunchHour(value),
          state: t(`flow.${selected.state}`),
          rate: formatFixed(selected.flowRate, 2),
        })}
      </div>
      <input
        type="range"
        min={0}
        max={23}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={t('menu.launchHour.aria')}
        className="start-menu-launch-hour-slider"
      />
      <div className="start-menu-launch-hour-strip" aria-hidden>
        {samples.map((sample: FlowForecastSample) => (
          <button
            key={`launch-hour-${sample.hour}`}
            type="button"
            className={`start-menu-launch-hour-tick ${sample.hour === value ? 'active' : ''}`}
            style={{ background: STATE_COLORS[classifyFlow(sample.flowRate)] }}
            title={t('menu.launchHour.tick', { hour: String(sample.hour), state: t(`flow.${sample.state}`) })}
            onClick={() => onChange(sample.hour)}
          />
        ))}
      </div>
      <p className="start-menu-map-hint">
        {t('menu.launchHour.hint')}
      </p>
    </div>
  );
}
