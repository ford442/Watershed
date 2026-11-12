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
import type { MapRegistryId } from '../maps/registry';
import { dailyDateKey, dailyRiverFor, type DailyRiver } from '../systems/daily/dailyRiver';
import { buildForecastSamples, classifyFlow } from '../systems/map/flowForecast';
import { getRunBest } from '../systems/persistence/PersistenceSystem';
import { formatRaceTimeMs } from '../systems/ghost/raceTimeFormat';
import { dailyRunKey } from '../utils/runContext';
import { useT } from '../i18n/useT';
import { formatFixed, formatLaunchHour, formatPercent } from '../i18n/format';
import { mapLabel } from '../i18n/mapLabel';
import type { WeatherType } from '../constants/weather';
import { registerEnglish } from '../i18n/i18n';
import { todaysRiver } from '../i18n/en/lazy/todaysRiver';

// This chunk's English rides with it, not the entry (#566).
registerEnglish(todaysRiver);

const STATE_COLORS: Record<string, string> = {
  [FLOW_FORECAST_STATES.NORMAL]: '#89d18b',
  [FLOW_FORECAST_STATES.HIGH_FLOW]: '#f3c969',
  [FLOW_FORECAST_STATES.FLOODED]: '#ff7f6e',
  [FLOW_FORECAST_STATES.WASHED_OUT]: '#c44bff',
};

/** A weather step's label key, or null for a type the catalog does not name. */
const weatherKey = (weather: string): `weather.${WeatherType}` | null =>
  weather === 'clear' || weather === 'rain' || weather === 'storm' || weather === 'fog' || weather === 'snow'
    ? `weather.${weather}`
    : null;

export interface TodaysRiverCardProps {
  /** Start today's run (map, hour and conditions come from the day). */
  onStart: (daily: DailyRiver) => void;
  bootReady: boolean;
  /** Override "now" (tests). */
  now?: number;
}

export default function TodaysRiverCard({ onStart, bootReady, now }: TodaysRiverCardProps) {
  const t = useT();
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
    <div className="start-menu-daily" aria-label={t('menu.daily')}>
      <div className="start-menu-daily-head">
        <span className="start-menu-map-select-label">{t('menu.daily')}</span>
        <span className="start-menu-daily-date">{t('menu.daily.date', { date: river.dateKey })}</span>
      </div>
      <div className="start-menu-daily-title">
        {t('menu.daily.title', {
          map: mapLabel(river.mapId),
          hour: formatLaunchHour(river.launchHour),
          state: t(`flow.${atLaunch.state}`),
          rate: formatFixed(atLaunch.flowRate, 2),
        })}
      </div>
      <div className="start-menu-daily-weather" aria-label={t('menu.daily.weatherAria')}>
        {conditions.weatherScript.map((step, i) => (
          <span key={`${step.atReachFraction}-${i}`} className={`start-menu-daily-step weather-${step.weather}`}>
            {i > 0 && <span aria-hidden> → </span>}
            {(() => {
              const key = weatherKey(step.weather);
              return key ? t(key) : step.weather;
            })()}
            {i > 0 && <span className="start-menu-daily-at"> {formatPercent(step.atReachFraction)}</span>}
          </span>
        ))}
      </div>
      <div className="start-menu-launch-hour-strip" aria-hidden>
        {samples.map((sample) => (
          <span
            key={`daily-hour-${sample.hour}`}
            className={`start-menu-launch-hour-tick ${sample.hour === river.launchHour ? 'active' : ''}`}
            style={{ background: STATE_COLORS[classifyFlow(sample.flowRate)] }}
            title={t('menu.launchHour.tick', { hour: String(sample.hour), state: t(`flow.${sample.state}`) })}
          />
        ))}
      </div>
      <p className="start-menu-map-hint">
        {t('menu.daily.conditions', {
          pattern: t(`menu.daily.pattern.${river.pattern}`),
          temperature: formatFixed(conditions.temperature, 1),
          snowpack: formatFixed(conditions.snowpackIndex, 2),
        })}
        {best !== undefined ? ` · ${t('menu.daily.best', { time: formatRaceTimeMs(best) })}` : ''}
      </p>
      <button
        type="button"
        className="start-menu-daily-btn"
        disabled={!bootReady}
        onClick={() => onStart(river)}
      >
        {t('menu.daily.run')}
      </button>
    </div>
  );
}
