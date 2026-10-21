/**
 * TodaysRiverCard — the StartMenu's "Today's River" (the Daily River, one per UTC day).
 *
 * Shows the day's map, launch hour, weather script and melt, the 24 h flow
 * forecast strip for that day, and today's best on this device; the button
 * starts the run with the day's conditions. Loaded lazily by the StartMenu, so
 * the generator never sits in the entry chunk.
 */
import React, { useMemo } from 'react';
import { FLOW_FORECAST_STATES } from '../constants/game';
import { DAM_RELEASE_SCHEDULE } from '../constants/forecast';
import { MAP_REGISTRY, type MapRegistryId } from '../maps/registry';
import { dailyDateKey, dailyRiverFor, type DailyRiver, type DailyWeatherPattern } from '../systems/daily/dailyRiver';
import { buildForecastSamples, classifyFlow } from '../systems/map/flowForecast';
import { getRunBest } from '../systems/persistence/PersistenceSystem';
import { formatRaceTimeMs } from '../systems/ghost/raceTimeFormat';
import { dailyRunKey } from '../utils/runContext';

const STATE_COLORS: Record<string, string> = {
  [FLOW_FORECAST_STATES.NORMAL]: '#89d18b',
  [FLOW_FORECAST_STATES.HIGH_FLOW]: '#f3c969',
  [FLOW_FORECAST_STATES.FLOODED]: '#ff7f6e',
  [FLOW_FORECAST_STATES.WASHED_OUT]: '#c44bff',
};

const PATTERN_LABELS: Record<DailyWeatherPattern, string> = {
  clear: 'Clear all day',
  squall: 'A squall crosses mid-reach, then clears',
  showers: 'Showers clearing',
  building: 'Weather building to a storm',
  fog: 'Morning fog lifting',
  flurries: 'Snow flurries passing',
};

const WEATHER_LABELS: Record<string, string> = {
  clear: 'Clear',
  rain: 'Rain',
  storm: 'Storm',
  fog: 'Fog',
  snow: 'Snow',
};

export interface TodaysRiverCardProps {
  /** Start today's run (map, hour and conditions come from the day). */
  onStart: (daily: DailyRiver) => void;
  bootReady: boolean;
  /** Override "now" (tests). */
  now?: number;
}

export default function TodaysRiverCard({ onStart, bootReady, now }: TodaysRiverCardProps) {
  const river = useMemo(() => dailyRiverFor(dailyDateKey(now)), [now]);
  const { conditions } = river;
  const samples = useMemo(
    () =>
      buildForecastSamples({
        temperature: conditions.temperature,
        snowpackIndex: conditions.snowpackIndex,
        damReleaseSchedule: DAM_RELEASE_SCHEDULE,
        startHour: 0,
        horizonHours: 24,
      }),
    [conditions.snowpackIndex, conditions.temperature],
  );
  const atLaunch = samples[river.launchHour] ?? samples[0];
  const best = useMemo(
    () => getRunBest(dailyRunKey(river.mapId as MapRegistryId, river.dateKey)).bestTimeMs,
    [river.dateKey, river.mapId],
  );

  return (
    <div className="start-menu-daily" aria-label="Today's River">
      <div className="start-menu-daily-head">
        <span className="start-menu-map-select-label">Today&apos;s River</span>
        <span className="start-menu-daily-date">{river.dateKey} UTC</span>
      </div>
      <div className="start-menu-daily-title">
        {MAP_REGISTRY[river.mapId].label} · H{String(river.launchHour).padStart(2, '0')}:00 ·{' '}
        {atLaunch.state} ({atLaunch.flowRate.toFixed(2)}x)
      </div>
      <div className="start-menu-daily-weather" aria-label="Weather script">
        {conditions.weatherScript.map((step, i) => (
          <span key={`${step.atReachFraction}-${i}`} className={`start-menu-daily-step weather-${step.weather}`}>
            {i > 0 && <span aria-hidden> → </span>}
            {WEATHER_LABELS[step.weather] ?? step.weather}
            {i > 0 && <span className="start-menu-daily-at"> {Math.round(step.atReachFraction * 100)}%</span>}
          </span>
        ))}
      </div>
      <div className="start-menu-launch-hour-strip" aria-hidden>
        {samples.map((sample) => (
          <span
            key={`daily-hour-${sample.hour}`}
            className={`start-menu-launch-hour-tick ${sample.hour === river.launchHour ? 'active' : ''}`}
            style={{ background: STATE_COLORS[classifyFlow(sample.flowRate)] }}
            title={`H${sample.hour}: ${sample.state}`}
          />
        ))}
      </div>
      <p className="start-menu-map-hint">
        {PATTERN_LABELS[river.pattern]} · {conditions.temperature.toFixed(1)} °C · snowpack{' '}
        {conditions.snowpackIndex.toFixed(2)}
        {best !== undefined ? ` · today's best ${formatRaceTimeMs(best)}` : ''}
      </p>
      <button
        type="button"
        className="start-menu-daily-btn"
        disabled={!bootReady}
        onClick={() => onStart(river)}
      >
        RUN TODAY&apos;S RIVER
      </button>
    </div>
  );
}
