/**
 * CP1 · GPU — draw calls, triangles, GPU geometries / textures (#559 C,
 * from `DebugPanel.tsx`).
 */
import React from 'react';
import type { PerfMetrics } from '../../debug/perfMetrics';
import { MetricRow, SectionTitle, tier } from './primitives';

export function GpuSection({ metrics }: { metrics: Readonly<PerfMetrics> }) {
  const drawTier = tier(metrics.drawCalls, 300, 500);

  return (
    <>
      <SectionTitle>CP1 · GPU — Draw Calls</SectionTitle>
      <MetricRow
        label="Draw calls / frame"
        value={metrics.drawCalls === 0 ? '—' : String(metrics.drawCalls)}
        t={drawTier}
        hint="Use <Instances> or InstancedMesh — bundle env objects into 1 draw call"
      />
      <MetricRow
        label="Triangles"
        value={metrics.triangles === 0 ? '—' : metrics.triangles.toLocaleString()}
        t="ok"
      />
      <MetricRow
        label="Geometries (GPU)"
        value={metrics.geometries === 0 ? '—' : String(metrics.geometries)}
        t="ok"
      />
      <MetricRow
        label="Textures (GPU)"
        value={metrics.textures === 0 ? '—' : String(metrics.textures)}
        t="ok"
      />
    </>
  );
}
