import React, { useMemo } from 'react';
import { FLOW_FORECAST_STATES, type FlowForecastState } from '../constants/game';

type ForecastSample = {
    hour: number;
    flowRate: number;
    state: FlowForecastState;
};

type ForecastHUDProps = {
    samples: ForecastSample[];
};

const STATE_LABELS: Record<FlowForecastState, string> = {
    [FLOW_FORECAST_STATES.NORMAL]: 'Normal',
    [FLOW_FORECAST_STATES.HIGH_FLOW]: 'High Flow',
    [FLOW_FORECAST_STATES.FLOODED]: 'Flooded',
};

const STATE_COLORS: Record<FlowForecastState, string> = {
    [FLOW_FORECAST_STATES.NORMAL]: '#89d18b',
    [FLOW_FORECAST_STATES.HIGH_FLOW]: '#f3c969',
    [FLOW_FORECAST_STATES.FLOODED]: '#ff7f6e',
};

export default function ForecastHUD({ samples }: ForecastHUDProps) {
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
        const highRiskHours = samples.filter((sample) => sample.state !== FLOW_FORECAST_STATES.NORMAL).length;

        return { current, maxFlow, highRiskHours };
    }, [samples]);

    const nextWindow = samples.slice(0, 6);

    return (
        <div
            style={{
                position: 'absolute',
                    top: 16,
                    left: 16,
                    zIndex: 20,
                    fontFamily: 'system-ui, sans-serif',
                    color: '#f4efe3',
                    width: 260,
                    textShadow: '0 1px 2px rgba(0,0,0,0.45)',
                }}
            >
                <div
                    style={{
                        background: 'rgba(15, 24, 28, 0.68)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 14,
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
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.88 }}>
                        Peak flow {summary.maxFlow.toFixed(2)}x, {summary.highRiskHours} risky hours in the next 24h
                    </div>

                    <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                        {nextWindow.map((sample) => (
                            <div
                                key={sample.hour}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '42px 1fr 48px',
                                    alignItems: 'center',
                                    gap: 8,
                                    fontSize: 12,
                                }}
                            >
                                <span style={{ opacity: 0.7 }}>H{sample.hour % 24}</span>
                                <span style={{ color: STATE_COLORS[sample.state] }}>{STATE_LABELS[sample.state]}</span>
                                <span style={{ textAlign: 'right', opacity: 0.9 }}>{sample.flowRate.toFixed(2)}x</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
    );
}
