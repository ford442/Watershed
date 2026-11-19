/**
 * SweHeightThumb — the SWE height field's min / mean / max, a thumbnail and a
 * histogram, from the gpu-chores stats store (#559 C, from `DebugPanel.tsx`).
 */
import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { getGpuChoreStats, subscribeGpuChoreStats } from '../../rendering/gpuChores';
import { MetricRow } from './primitives';

function formatHeight(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(3);
}


export function SweHeightThumb() {
  const stats = useSyncExternalStore(subscribeGpuChoreStats, getGpuChoreStats, getGpuChoreStats);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = thumbRef.current;
    const thumb = stats.thumb;
    if (!canvas || !thumb) return;
    canvas.width = thumb.width;
    canvas.height = thumb.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(thumb.width, thumb.height);
    const lo = stats.min ?? 0;
    const hi = stats.max ?? 1;
    const span = hi - lo || 1;
    for (let i = 0; i < thumb.values.length; i += 1) {
      const t = (thumb.values[i] - lo) / span;
      const g = Math.round(Math.max(0, Math.min(1, t)) * 255);
      const p = i * 4;
      image.data[p] = Math.round(g * 0.35);
      image.data[p + 1] = Math.round(g * 0.75);
      image.data[p + 2] = 180 + Math.round(g * 0.25);
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [stats.thumb, stats.min, stats.max]);

  useEffect(() => {
    const canvas = histRef.current;
    const bins = stats.histogram;
    if (!canvas || !bins) return;
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    let peak = 1;
    for (let i = 0; i < bins.length; i += 1) {
      if (bins[i] > peak) peak = bins[i];
    }
    ctx.fillStyle = 'rgba(110, 200, 255, 0.85)';
    const barW = w / bins.length;
    for (let i = 0; i < bins.length; i += 1) {
      const bh = (bins[i] / peak) * (h - 1);
      ctx.fillRect(i * barW, h - bh, Math.max(1, barW), bh);
    }
  }, [stats.histogram]);

  return (
    <div style={{ marginBottom: 6 }}>
      <MetricRow
        label="SWE height"
        value={
          stats.min == null
            ? '—'
            : `${formatHeight(stats.min)} / ${formatHeight(stats.mean)} / ${formatHeight(stats.max)}`
        }
        t="ok"
        hint="min / mean / max via gpu-chores"
      />
      <MetricRow
        label="Chores"
        value={stats.backend ?? '—'}
        t={stats.backend ? 'ok' : 'warn'}
        hint={stats.reason ?? undefined}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch', marginTop: 4 }}>
        <canvas
          ref={thumbRef}
          width={32}
          height={20}
          style={{
            width: 96,
            height: 60,
            imageRendering: 'pixelated',
            borderRadius: 3,
            background: 'rgba(0,0,0,0.35)',
            flex: '0 0 auto',
          }}
        />
        <canvas
          ref={histRef}
          width={128}
          height={40}
          style={{
            flex: 1,
            height: 60,
            borderRadius: 3,
            background: 'rgba(0,0,0,0.35)',
          }}
        />
      </div>
    </div>
  );
}
