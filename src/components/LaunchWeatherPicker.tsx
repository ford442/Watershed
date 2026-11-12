import React from 'react';
import type { WeatherType } from '../constants/weather';
import { weatherFlowRateDelta, DEFAULT_WEATHER_INTENSITY } from '../systems/map/weatherInflow';
import { useT } from '../i18n/useT';
import { formatFixed } from '../i18n/format';

/** The pickable weathers, in menu order; labels and hints are `weather.<type>` / `menu.weather.hint.<type>`. */
const OPTIONS: ReadonlyArray<WeatherType> = ['clear', 'rain', 'storm', 'snow', 'fog'];

type LaunchWeatherPickerProps = {
  value: WeatherType;
  launchHour: number;
  onChange: (type: WeatherType) => void;
};

/** Pre-run weather (#464): locked for the run like the launch hour, and part of the ghost's river. */
export default function LaunchWeatherPicker({ value, launchHour, onChange }: LaunchWeatherPickerProps) {
  const t = useT();
  const selected = OPTIONS.find((type) => type === value) ?? OPTIONS[0];
  const runoff = weatherFlowRateDelta(launchHour, { type: value, intensity: DEFAULT_WEATHER_INTENSITY[value] });
  return (
    <div className="start-menu-launch-hour">
      <div className="start-menu-map-select-label">{t('menu.weather')}</div>
      <div className="start-menu-mode-row" role="radiogroup" aria-label={t('menu.weather.aria')}>
        {OPTIONS.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={type === value}
            className={`start-menu-mode-option ${type === value ? 'active' : ''}`}
            onClick={() => onChange(type)}
          >
            {t(`weather.${type}`)}
          </button>
        ))}
      </div>
      <p className="start-menu-map-hint">
        {t(`menu.weather.hint.${selected}`)}
        {runoff > 0 ? ` ${t('menu.weather.runoff', { rate: formatFixed(runoff, 2) })}` : ''}
      </p>
    </div>
  );
}
