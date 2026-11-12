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

const STATE_COLORS: Record<FlowForecastState, string> = {
  [FLOW_FORECAST_STATES.NORMAL]: '#89d18b',
  [FLOW_FORECAST_STATES.HIGH_FLOW]: '#f3c969',
  [FLOW_FORECAST_STATES.FLOODED]: '#ff7f6e',
  [FLOW_FORECAST_STATES.WASHED_OUT]: '#c44bff',
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
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 20,
        fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
        color: '#f4efe3',
        width: 280,
        textShadow: '0 1px 2px rgba(0,0,0,0.45)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          background: 'rgba(15, 24, 28, 0.72)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12,
          padding: '12px 14px',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.8 }}>
          {t('forecast.title')}
        </div>
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
          {t('forecast.launch', { hour: formatLaunchHour(launchHour ?? samples[0]?.hour ?? 0) })}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: STATE_COLORS[summary.current],
              boxShadow: `0 0 12px ${STATE_COLORS[summary.current]}`,
            }}
          />
          <div style={{ fontSize: 18, fontWeight: 700 }}>{t(STATE_LABELS[summary.current])}</div>
          <div style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>
            {t('forecast.seg', { index: String(currentSegmentIndex) })}
          </div>
        </div>

        {/* Next-N segment risk strip */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', opacity: 0.65, marginBottom: 6 }}>
            {t('forecast.nextSegments', { count: riskStrip.length })}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {riskStrip.map((sample, index) => {
              const isCurrent = index === 0;
              return (
                <div
                  key={`risk-${sample.hour}-${index}`}
                  title={t('forecast.segTooltip', {
                    index: String(currentSegmentIndex + index),
                    state: t(STATE_LABELS[sample.state]),
                    flow: formatFixed(sample.flowRate, 2),
                  })}
                  style={{
                    flex: 1,
                    height: isCurrent ? 18 : 14,
                    borderRadius: 4,
                    background: STATE_COLORS[sample.state],
                    opacity: isCurrent ? 1 : 0.85,
                    outline: isCurrent ? '1px solid rgba(255,255,255,0.55)' : 'none',
                    boxShadow: isElevatedRisk(sample.state)
                      ? `0 0 8px ${STATE_COLORS[sample.state]}88`
                      : 'none',
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, opacity: 0.65 }}>
            <span>{t('forecast.now')}</span>
            <span>+{Math.max(0, riskStrip.length - 1)}</span>
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.88 }}>
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
          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(90, 190, 255, 0.12)',
              border: '1px solid rgba(90, 190, 255, 0.32)',
              fontSize: 12,
            }}
          >
            <div style={{ letterSpacing: 1.2, textTransform: 'uppercase', fontSize: 10, opacity: 0.8 }}>
              {t('forecast.waterAt', { hour: formatLaunchHour(hydroBoard.launchHour) })}
            </div>
            {hydroBoard.rows.length === 0 ? (
              <div style={{ marginTop: 3, opacity: 0.8 }}>{t('forecast.baseline')}</div>
            ) : (
              hydroBoard.rows.map((row) => (
                <div
                  key={row.id}
                  style={{
                    marginTop: 3,
                    fontWeight: row.here ? 700 : 500,
                    opacity: row.here ? 1 : 0.85,
                  }}
                >
                  {row.here ? '▶ ' : '· '}
                  {t(HYDRO_KIND_LABELS[row.kind])}{' '}
                  <span style={{ opacity: 0.7 }}>
                    {t('forecast.rowDetail', {
                      index: String(row.segmentIndex),
                      effect: t(HYDRO_KIND_EFFECTS[row.kind]),
                    })}
                  </span>
                </div>
              ))
            )}
            {contrastLine && (
              <div style={{ marginTop: 6, fontSize: 11, opacity: 0.72 }}>{contrastLine}</div>
            )}
          </div>
        )}

        {damCountdown && (
          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(255, 140, 80, 0.14)',
              border: '1px solid rgba(255, 140, 80, 0.35)',
              fontSize: 12,
            }}
          >
            <div style={{ letterSpacing: 1.2, textTransform: 'uppercase', fontSize: 10, opacity: 0.8 }}>
              {t('forecast.damRelease')}
            </div>
            <div style={{ marginTop: 2, fontWeight: 600 }}>
              {damCountdown.hoursUntil === 0
                ? t('forecast.releasingNow')
                : t('forecast.releaseIn', { hours: damCountdown.hoursUntil })}{' '}
              <span style={{ opacity: 0.75, fontWeight: 400 }}>
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
