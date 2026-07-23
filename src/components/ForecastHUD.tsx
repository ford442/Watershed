import React, { useMemo } from 'react';
import { FLOW_FORECAST_STATES, type FlowForecastState } from '../constants/game';
import {
  FORECAST_HUD_LOOKAHEAD,
  isElevatedRisk,
  nextDamReleaseCountdown,
  upcomingRiskStrip,
  type DamReleaseEntry,
  type FlowForecastSample,
} from '../systems/flowForecast';

type ForecastHUDProps = {
  samples: FlowForecastSample[];
  damReleaseSchedule?: ReadonlyArray<DamReleaseEntry>;
  currentSegmentIndex?: number;
};

const STATE_LABELS: Record<FlowForecastState, string> = {
  [FLOW_FORECAST_STATES.NORMAL]: 'Normal',
  [FLOW_FORECAST_STATES.HIGH_FLOW]: 'High',
  [FLOW_FORECAST_STATES.FLOODED]: 'Flood',
  [FLOW_FORECAST_STATES.WASHED_OUT]: 'Washout',
};

const STATE_COLORS: Record<FlowForecastState, string> = {
  [FLOW_FORECAST_STATES.NORMAL]: '#89d18b',
  [FLOW_FORECAST_STATES.HIGH_FLOW]: '#f3c969',
  [FLOW_FORECAST_STATES.FLOODED]: '#ff7f6e',
  [FLOW_FORECAST_STATES.WASHED_OUT]: '#c44bff',
};

export default function ForecastHUD({
  samples,
  damReleaseSchedule = [],
  currentSegmentIndex = 0,
}: ForecastHUDProps) {
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
    const currentHour = samples[0]?.hour ?? 0;
    return nextDamReleaseCountdown(damReleaseSchedule, currentHour);
  }, [damReleaseSchedule, samples]);

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
          Flow Forecast
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
          <div style={{ fontSize: 18, fontWeight: 700 }}>{STATE_LABELS[summary.current]}</div>
          <div style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>
            Seg {currentSegmentIndex}
          </div>
        </div>

        {/* Next-N segment risk strip */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', opacity: 0.65, marginBottom: 6 }}>
            Next {riskStrip.length} segments
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {riskStrip.map((sample, index) => {
              const isCurrent = index === 0;
              return (
                <div
                  key={`risk-${sample.hour}-${index}`}
                  title={`Seg ${currentSegmentIndex + index}: ${STATE_LABELS[sample.state]} (${sample.flowRate.toFixed(2)}x)`}
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
            <span>now</span>
            <span>+{Math.max(0, riskStrip.length - 1)}</span>
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.88 }}>
          Peak {summary.maxFlow.toFixed(2)}x · {summary.highRiskHours} risky hrs
          {nextHazard ? ` · hazard in ${riskStrip.indexOf(nextHazard)} seg` : ''}
        </div>

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
              Dam release
            </div>
            <div style={{ marginTop: 2, fontWeight: 600 }}>
              {damCountdown.hoursUntil === 0
                ? 'Releasing now'
                : `T−${damCountdown.hoursUntil}h`}{' '}
              <span style={{ opacity: 0.75, fontWeight: 400 }}>
                (+{damCountdown.release.toFixed(2)} flow @ H{damCountdown.hour % 24})
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
