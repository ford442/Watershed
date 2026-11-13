/**
 * CP4 · Shader — fill rate: FPS and the JS heap (#559 C, from
 * `DebugPanel.tsx`).
 */
import React from 'react';
import type { PerfMetrics } from '../../debug/perfMetrics';
import { MetricRow, SectionTitle, tier } from './primitives';

export function FillRateSection({ metrics }: { metrics: Readonly<PerfMetrics> }) {
  const fpsTier = tier(metrics.fps, 45, 30, true);
  const memTier = tier(metrics.memoryMB, 200, 300);

  return (
    <>
      <SectionTitle>CP4 · Shader — Fill Rate</SectionTitle>
      <MetricRow
        label="FPS (30-frame avg)"
        value={metrics.fps === 0 ? '—' : `${metrics.fps}`}
        t={fpsTier}
        hint="Resize window smaller — if FPS jumps, shaders are fill-rate bound → lower pixelRatio"
      />
      <MetricRow
        label="JS Heap"
        value={metrics.memoryMB === 0 ? '— (non-Chrome)' : `${metrics.memoryMB} MB`}
        t={memTier}
        hint="High GC pressure — check for new arrays/objects created per frame in useFrame"
      />
    </>
  );
}
