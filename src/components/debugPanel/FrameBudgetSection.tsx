/**
 * CP3 · React — frame budget: frame time, CPU work, GPU time (#559 C, from
 * `DebugPanel.tsx`).
 */
import React from 'react';
import type { PerfMetrics } from '../../debug/perfMetrics';
import { GPU_TIMER_SOURCE_LABELS } from '../../rendering/gpuTimer';
import { MetricRow, SectionTitle, tier } from './primitives';

export function FrameBudgetSection({ metrics }: { metrics: Readonly<PerfMetrics> }) {
  const ftTier = tier(metrics.frameTimeMs, 12, 16.67);

  return (
    <>
      <SectionTitle>CP3 · React — Frame Budget</SectionTitle>
      <MetricRow
        label="Avg frame time"
        value={metrics.frameTimeMs === 0 ? '—' : `${metrics.frameTimeMs} ms`}
        t={ftTier}
        hint="Check useFrame in TrackManager/Player for setState or new object creation"
      />
      <MetricRow
        label="CPU work / frame"
        value={metrics.cpuWorkMs === 0 ? '—' : `${metrics.cpuWorkMs} ms`}
        t={metrics.cpuWorkMs > 12 ? 'warn' : 'ok'}
        hint="First useFrame callback → last render, excluding vsync idle — half of what the render-scale valve reads"
      />
      <MetricRow
        label={GPU_TIMER_SOURCE_LABELS[metrics.gpuTimerSource]}
        value={metrics.gpuMs === null ? '— (no GPU timer)' : `${metrics.gpuMs} ms`}
        t={metrics.gpuMs !== null && metrics.gpuMs > 14 ? 'warn' : 'ok'}
        hint="GPU frame time; the valve acts on max(GPU, CPU work). Without a GPU timer it uses CPU work, or rAF time when frames miss vsync"
      />
    </>
  );
}
