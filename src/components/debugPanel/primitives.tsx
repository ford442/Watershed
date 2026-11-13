/**
 * The debug panel's shared pieces (#559 C, from `DebugPanel.tsx`): the
 * ok / warn / fail tiers and their colours, the section title, the divider
 * and the metric row every section is built from.
 */
import React from 'react';

export type Tier = 'ok' | 'warn' | 'fail';

export function tier(value: number, warnAt: number, failAt: number, invert = false): Tier {
  if (!invert) {
    if (value >= failAt) return 'fail';
    if (value >= warnAt) return 'warn';
    return 'ok';
  } else {
    // invert: high is good (e.g. FPS)
    if (value < failAt) return 'fail';
    if (value < warnAt) return 'warn';
    return 'ok';
  }
}

const TIER_COLOR: Record<Tier, string> = {
  ok:   '#6dde7a',
  warn: '#f5c542',
  fail: '#ff6b6b',
};

const TIER_BG: Record<Tier, string> = {
  ok:   'rgba(109,222,122,0.08)',
  warn: 'rgba(245,197,66,0.10)',
  fail: 'rgba(255,107,107,0.12)',
};

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontWeight: 700,
      fontSize: 11,
      letterSpacing: '0.08em',
      color: '#9fd6ff',
      marginBottom: 6,
      marginTop: 4,
      textTransform: 'uppercase',
    }}>
      {children}
    </div>
  );
}

export function Divider() {
  return <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', margin: '8px 0' }} />;
}

interface MetricRowProps {
  label: string;
  value: string;
  t: Tier;
  hint?: string;
}

export function MetricRow({ label, value, t, hint }: MetricRowProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      background: t !== 'ok' ? TIER_BG[t] : undefined,
      borderRadius: 4,
      padding: '3px 4px',
      marginBottom: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#d0d0d0' }}>{label}</span>
        <span style={{ color: TIER_COLOR[t], fontWeight: 600 }}>{value}</span>
      </div>
      {t !== 'ok' && hint && (
        <div style={{ color: TIER_COLOR[t], fontSize: 10, marginTop: 2, opacity: 0.85 }}>
          ↳ {hint}
        </div>
      )}
    </div>
  );
}
