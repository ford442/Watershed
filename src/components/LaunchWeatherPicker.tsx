import React from 'react';
import type { WeatherType } from '../constants/weather';
import { weatherFlowRateDelta, DEFAULT_WEATHER_INTENSITY } from '../systems/map/weatherInflow';

const OPTIONS: ReadonlyArray<{ type: WeatherType; label: string; hint: string }> = [
  { type: 'clear', label: 'Clear', hint: 'The river as forecast.' },
  { type: 'rain', label: 'Rain', hint: 'Runoff raises the river from the source down.' },
  { type: 'storm', label: 'Storm', hint: 'Heavy runoff, worst in the afternoon. Lightning.' },
  { type: 'snow', label: 'Snow', hint: 'No extra water — the melt turns to slush and drags.' },
  { type: 'fog', label: 'Fog', hint: 'Low visibility; the river is unchanged.' },
];

type LaunchWeatherPickerProps = {
  value: WeatherType;
  launchHour: number;
  onChange: (type: WeatherType) => void;
};

/** Pre-run weather (#464): locked for the run like the launch hour, and part of the ghost's river. */
export default function LaunchWeatherPicker({ value, launchHour, onChange }: LaunchWeatherPickerProps) {
  const selected = OPTIONS.find((option) => option.type === value) ?? OPTIONS[0];
  const runoff = weatherFlowRateDelta(launchHour, { type: value, intensity: DEFAULT_WEATHER_INTENSITY[value] });
  return (
    <div className="start-menu-launch-hour">
      <div className="start-menu-map-select-label">Weather</div>
      <div className="start-menu-mode-row" role="radiogroup" aria-label="Select launch weather">
        {OPTIONS.map((option) => (
          <button
            key={option.type}
            type="button"
            role="radio"
            aria-checked={option.type === value}
            className={`start-menu-mode-option ${option.type === value ? 'active' : ''}`}
            onClick={() => onChange(option.type)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="start-menu-map-hint">
        {selected.hint}
        {runoff > 0 ? ` +${runoff.toFixed(2)}x flow at the source.` : ''}
      </p>
    </div>
  );
}
