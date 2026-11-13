import React, { useMemo } from 'react';
import { FLOW_FORECAST_STATES, type FlowForecastState } from '../constants/game';
import {
  FORECAST_HUD_LOOKAHEAD,
  isElevatedRisk,
  nextDamReleaseCountdown,
  nextPeakCountdown,
  upcomingRiskStrip,
  type DamReleaseEntry,
  type FlowForecastSample,
} from '../systems/map/flowForecast';
import { buildHydroHudBoard } from '../systems/water/hydroHud';
import type { HydroEvent, HydroEventKind } from '../systems/water/hydroEvents';
import { useT } from '../i18n/useT';
import type { MessageKey } from '../i18n/i18n';
import { formatFixed, formatLaunchHour, formatList } from '../i18n/format';

type ForecastHUDProps = {
  samples: FlowForecastSample[];
  launchHour?: number;
  damReleaseSchedule?: ReadonlyArray<DamReleaseEntry>;
  currentSegmentIndex?: number;
  /** Authored SWE events for the active map (#397). */
  hydroEvents?: readonly HydroEvent[];
};

const STATE_LABELS = {
  [FLOW_FORECAST_STATES.NORMAL]: 'forecast.stateNormal',
  [FLOW_FORECAST_STATES.HIGH_FLOW]: 'forecast.stateHigh',
  [FLOW_FORECAST_STATES.FLOODED]: 'forecast.stateFlood',
  [FLOW_FORECAST_STATES.WASHED_OUT]: 'forecast.stateWashout',
} as const satisfies Record<FlowForecastState, MessageKey>;

/** The hydro board's words (hydroHud returns kinds; #566). */
const HYDRO_KIND_LABELS = {
  inflowPulse: 'hydro.kindInflowPulse',
  vortex: 'hydro.kindVortex',
  braid: 'hydro.kindBraid',
  roughness: 'hydro.kindRoughness',
  surge: 'hydro.kindSurge',
} as const satisfies Record<HydroEventKind, MessageKey>;

/** What each kind does to the river, one clause, for the HUD subtitle. */
const HYDRO_KIND_EFFECTS = {
  inflowPulse: 'hydro.effectInflowPulse',
  vortex: 'hydro.effectVortex',
  braid: 'hydro.effectBraid',
  roughness: 'hydro.effectRoughness',
  surge: 'hydro.effectSurge',
} as const satisfies Record<HydroEventKind, MessageKey>;

/**
 * Each state's colour (an access-palette custom property, #558 C.2) *and* its
 * shape (C.1): the strip reads without colour, and the colour follows the
 * player's colour-vision mode.
 */
const STATE_CLASS: Record<FlowForecastState, string> = {
  [FLOW_FORECAST_STATES.NORMAL]: 'normal',
  [FLOW_FORECAST_STATES.HIGH_FLOW]: 'high',
  [FLOW_FORECAST_STATES.FLOODED]: 'flood',
  [FLOW_FORECAST_STATES.WASHED_OUT]: 'washout',
};

const STATE_GLYPH: Record<FlowForecastState, string> = {
  [FLOW_FORECAST_STATES.NORMAL]: '●',
  [FLOW_FORECAST_STATES.HIGH_FLOW]: '▲',
  [FLOW_FORECAST_STATES.FLOODED]: '◆',
  [FLOW_FORECAST_STATES.WASHED_OUT]: '✖',
};

export default function ForecastHUD({
  samples,
  launchHour,
  damReleaseSchedule = [],
  currentSegmentIndex = 0,
  hydroEvents,
}: ForecastHUDProps) {
  const t = useT();
  const summary = useMemo(() => {
    if (!samples.length) {
      return {
        current: FLOW_FORECAST_STATES.NORMAL,
        maxFlow: 0,
        highRiskHours: 0,
      };
    }

    const current = samples[0].state;
    const maxFlow = samples.reduce((value, sample) => Math.max(value, sample.flowRate), 0);
    const highRiskHours = samples.filter((sample) => isElevatedRisk(sample.state)).length;

    return { current, maxFlow, highRiskHours };
  }, [samples]);

  const riskStrip = useMemo(
    () => upcomingRiskStrip(samples, FORECAST_HUD_LOOKAHEAD),
    [samples],
  );

  const damCountdown = useMemo(() => {
    const currentHour = samples[0]?.hour ?? launchHour ?? 0;
    return nextDamReleaseCountdown(damReleaseSchedule, currentHour);
  }, [damReleaseSchedule, launchHour, samples]);

  const peakCountdown = useMemo(() => nextPeakCountdown(samples), [samples]);

  // Authored hour board: what this launch hour actually changed in the water,
  // and what the other scouting hour would have changed instead.
  const hydroBoard = useMemo(
    () => buildHydroHudBoard(hydroEvents, launchHour ?? 0, currentSegmentIndex),
    [hydroEvents, launchHour, currentSegmentIndex],
  );

  // What the other scouting hour would have changed, as one line.
  const contrastLine =
    hydroBoard.gained.length > 0
      ? t('hydro.contrast', {
          hour: formatLaunchHour(hydroBoard.contrastHour),
          events: formatList(
            hydroBoard.gained.map((event) =>
              t('hydro.contrastEvent', {
                label: t(HYDRO_KIND_LABELS[event.kind]),
                index: String(event.segmentIndex),
              }),
            ),
          ),
        })
      : null;

  const nextHazard = riskStrip.find((sample, index) => index > 0 && isElevatedRisk(sample.state));

  return (
    <div className="forecast-hud">
      <div className="forecast-hud__card">
        <div className="forecast-hud__title">{t('forecast.title')}</div>
        <div className="forecast-hud__launch">
          {t('forecast.launch', { hour: formatLaunchHour(launchHour ?? samples[0]?.hour ?? 0) })}
        </div>
        <div className="forecast-hud__state">
          <span
            className={`forecast-hud__dot forecast-risk--${STATE_CLASS[summary.current]}`}
            aria-hidden="true"
          >
            {STATE_GLYPH[summary.current]}
          </span>
          <div className="forecast-hud__state-label">{t(STATE_LABELS[summary.current])}</div>
          <div className="forecast-hud__seg">
            {t('forecast.seg', { index: String(currentSegmentIndex) })}
          </div>
        </div>

        {/* Next-N segment risk strip */}
        <div className="forecast-hud__strip-wrap">
          <div className="forecast-hud__caption">
            {t('forecast.nextSegments', { count: riskStrip.length })}
          </div>
          <div className="forecast-hud__strip">
            {riskStrip.map((sample, index) => {
              const isCurrent = index === 0;
              const label = t('forecast.segTooltip', {
                index: String(currentSegmentIndex + index),
                state: t(STATE_LABELS[sample.state]),
                flow: formatFixed(sample.flowRate, 2),
              });
              return (
                <div
                  key={`risk-${sample.hour}-${index}`}
                  title={label}
                  aria-label={label}
                  role="img"
                  className={[
                    'forecast-hud__cell',
                    `forecast-risk--${STATE_CLASS[sample.state]}`,
                    isCurrent ? 'forecast-hud__cell--current' : '',
                    isElevatedRisk(sample.state) ? 'forecast-hud__cell--elevated' : '',
                  ].join(' ')}
                >
                  {STATE_GLYPH[sample.state]}
                </div>
              );
            })}
          </div>
          <div className="forecast-hud__strip-ends">
            <span>{t('forecast.now')}</span>
            <span>+{Math.max(0, riskStrip.length - 1)}</span>
          </div>
        </div>

        <div className="forecast-hud__summary">
          {[
            t('forecast.peak', { flow: formatFixed(summary.maxFlow, 2) }),
            t('forecast.riskyHours', { count: summary.highRiskHours }),
            nextHazard ? t('forecast.hazardIn', { count: riskStrip.indexOf(nextHazard) }) : null,
            peakCountdown ? t('forecast.nextPeak', { hours: peakCountdown.hoursUntil }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>

        {(hydroBoard.rows.length > 0 || contrastLine) && (
          <div className="forecast-hud__box forecast-hud__box--hydro">
            <div className="forecast-hud__box-title">
              {t('forecast.waterAt', { hour: formatLaunchHour(hydroBoard.launchHour) })}
            </div>
            {hydroBoard.rows.length === 0 ? (
              <div className="forecast-hud__row forecast-hud__row--dim">{t('forecast.baseline')}</div>
            ) : (
              hydroBoard.rows.map((row) => (
                <div key={row.id} className={`forecast-hud__row ${row.here ? 'forecast-hud__row--here' : ''}`}>
                  {row.here ? '▶ ' : '· '}
                  {t(HYDRO_KIND_LABELS[row.kind])}{' '}
                  <span className="forecast-hud__row-detail">
                    {t('forecast.rowDetail', {
                      index: String(row.segmentIndex),
                      effect: t(HYDRO_KIND_EFFECTS[row.kind]),
                    })}
                  </span>
                </div>
              ))
            )}
            {contrastLine && <div className="forecast-hud__contrast">{contrastLine}</div>}
          </div>
        )}

        {damCountdown && (
          <div className="forecast-hud__box forecast-hud__box--dam">
            <div className="forecast-hud__box-title">{t('forecast.damRelease')}</div>
            <div className="forecast-hud__dam">
              {damCountdown.hoursUntil === 0
                ? t('forecast.releasingNow')
                : t('forecast.releaseIn', { hours: damCountdown.hoursUntil })}{' '}
              <span className="forecast-hud__dam-detail">
                {t('forecast.releaseDetail', {
                  release: formatFixed(damCountdown.release, 2),
                  hour: String(damCountdown.hour % 24),
                })}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
