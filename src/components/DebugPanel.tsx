import React, { useState, useEffect, useSyncExternalStore } from 'react';
import { DebugStageController, DebugStageId, DebugStageStatus } from '../debug/debugStages';
import { getPerfMetrics, subscribePerfMetrics } from '../debug/perfMetrics';
import { getRendererDiagnostics, subscribeRendererDiagnostics } from '../rendering/rendererState';
import type { RendererPreference } from '../rendering/types';

// ─── Shared styles ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<DebugStageStatus, { icon: string; color: string }> = {
  idle:     { icon: '○', color: '#9e9e9e' },
  loading:  { icon: '⏳', color: '#f5c542' },
  success:  { icon: '✓', color: '#6dde7a' },
  failure:  { icon: '✗', color: '#ff6b6b' },
  disabled: { icon: '—', color: '#6f6f6f' },
};

type Tier = 'ok' | 'warn' | 'fail';

function tier(value: number, warnAt: number, failAt: number, invert = false): Tier {
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
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

function Divider() {
  return <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', margin: '8px 0' }} />;
}

interface MetricRowProps {
  label: string;
  value: string;
  t: Tier;
  hint?: string;
}

function MetricRow({ label, value, t, hint }: MetricRowProps) {
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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DebugPanelProps {
  debug: DebugStageController;
  physicsDebug?: boolean;
  onTogglePhysicsDebug?: (val: boolean) => void;
  rendererPreference?: RendererPreference;
  onRendererPreferenceChange?: (preference: RendererPreference) => void;
  wireframeDebug?: boolean;
  onToggleWireframeDebug?: (val: boolean) => void;
  /** Hide panel + debug overlays for screenshots / live test runs */
  onEnableCleanTest?: () => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DebugPanel({
  debug,
  physicsDebug = false,
  onTogglePhysicsDebug,
  rendererPreference = 'webgpu',
  onRendererPreferenceChange,
  wireframeDebug = false,
  onToggleWireframeDebug,
  onEnableCleanTest,
}: DebugPanelProps) {
  const [stagesOpen, setStagesOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // Subscribe to live perf metrics from PerfCheckpointMonitor (inside Canvas)
  const metrics = useSyncExternalStore(subscribePerfMetrics, getPerfMetrics);
  const rendererDiagnostics = useSyncExternalStore(subscribeRendererDiagnostics, getRendererDiagnostics);

  if (!debug.debugEnabled) return null;

  const stageIds = Object.keys(debug.stageConfig) as DebugStageId[];
  const failCount = stageIds.filter(
    (id) => debug.stageRuntime[id]?.status === 'failure'
  ).length;

  // Tier calculations
  const drawTier   = tier(metrics.drawCalls, 300, 500);
  const ftTier     = tier(metrics.frameTimeMs, 12, 16.67);
  const fpsTier    = tier(metrics.fps, 45, 30, true);
  const memTier    = tier(metrics.memoryMB, 200, 300);

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 20000,
        background: 'rgba(10, 10, 16, 0.93)',
        color: '#f1f1f1',
        padding: minimized ? '8px 10px' : '10px 12px',
        borderRadius: 8,
        border: '1px solid rgba(120, 180, 255, 0.35)',
        width: minimized ? 'auto' : 300,
        maxHeight: minimized ? 'none' : '82vh',
        overflowY: minimized ? 'visible' : 'auto',
        boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        pointerEvents: 'auto',
      }}
      aria-label="Debug Stages Panel"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: minimized ? 0 : 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          ⚡ PERF DIAGNOSTICS
          <span style={{ fontWeight: 400, fontSize: 10, color: '#888', marginLeft: 8 }}>?debug=1</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onEnableCleanTest && (
            <button
              type="button"
              onClick={onEnableCleanTest}
              title="Hide debug panel, forecast HUD, wireframes, and physics overlay"
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid rgba(109,222,122,0.45)',
                background: 'rgba(109,222,122,0.12)',
                color: '#6dde7a',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 10,
              }}
            >
              Clean
            </button>
          )}
          <button
            type="button"
            onClick={() => setMinimized((m) => !m)}
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'transparent',
              color: '#ccc',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 10,
            }}
          >
            {minimized ? '▾' : '▴'}
          </button>
        </div>
      </div>

      {minimized ? null : (
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

      <Divider />

      {/* ── Renderer backend toggle ─────────────────────────────────────── */}
      <SectionTitle>Renderer — WebGPU / WebGL2</SectionTitle>
      <div style={{ marginBottom: 6, color: '#d0d0d0' }}>
        Active: <span style={{ color: '#9fd6ff' }}>{rendererDiagnostics.rendererName}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {(['webgpu', 'webgl'] as RendererPreference[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onRendererPreferenceChange?.(mode)}
            style={{
              flex: 1,
              padding: '4px 6px',
              borderRadius: 4,
              border: rendererPreference === mode
                ? '1px solid #6dde7a'
                : '1px solid rgba(255,255,255,0.18)',
              background: rendererPreference === mode
                ? 'rgba(109,222,122,0.15)'
                : 'rgba(255,255,255,0.04)',
              color: rendererPreference === mode ? '#6dde7a' : '#ccc',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
            }}
          >
            {mode === 'webgpu' ? 'WebGPU' : 'WebGL2'}
          </button>
        ))}
      </div>
      <div style={{ color: '#888', fontSize: 10, marginBottom: 4 }}>
        URL: <code>?renderer=webgl</code> or <code>?renderer=webgpu</code>
      </div>

      <Divider />

      {/* ── CP2: Physics debug ──────────────────────────────────────────── */}
      <SectionTitle>CP2 · CPU — Physics Colliders</SectionTitle>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={physicsDebug}
          onChange={(e) => onTogglePhysicsDebug?.(e.target.checked)}
        />
        <span style={{ color: physicsDebug ? '#6dde7a' : '#d0d0d0' }}>
          Show physics HUD + collider wireframes (F)
        </span>
      </label>
      {physicsDebug && (
        <div style={{ color: '#f5c542', fontSize: 10, marginBottom: 4 }}>
          ↳ Press P to log current physics snapshot in the console
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={wireframeDebug}
          onChange={(e) => onToggleWireframeDebug?.(e.target.checked)}
        />
        <span style={{ color: wireframeDebug ? '#6dde7a' : '#d0d0d0' }}>
          Wireframe geometry overlay (G)
        </span>
      </label>

      <Divider />

      {/* ── CP3: Frame budget (React/JS) ────────────────────────────────── */}
      <SectionTitle>CP3 · React — Frame Budget</SectionTitle>
      <MetricRow
        label="Avg frame time"
        value={metrics.frameTimeMs === 0 ? '—' : `${metrics.frameTimeMs} ms`}
        t={ftTier}
        hint="Check useFrame in TrackManager/Player for setState or new object creation"
      />

      <Divider />

      {/* ── CP4: FPS / Fill rate ────────────────────────────────────────── */}
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

      <Divider />

      {/* ── Load stages (collapsible) ────────────────────────────────────── */}
      <button
        onClick={() => setStagesOpen((o) => !o)}
        style={{
          background: 'none',
          border: 'none',
          color: '#9fd6ff',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 11,
          fontWeight: 700,
          padding: '2px 0',
          letterSpacing: '0.06em',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          textTransform: 'uppercase',
        }}
      >
        {stagesOpen ? '▾' : '▸'} LOAD STAGES
        {failCount > 0 && (
          <span style={{
            background: '#ff6b6b',
            color: '#fff',
            borderRadius: 10,
            padding: '0 5px',
            fontSize: 10,
            fontWeight: 700,
          }}>
            {failCount}
          </span>
        )}
      </button>

      {stagesOpen && (
        <div style={{ marginTop: 6 }}>
          {stageIds.map((stageId) => {
            const runtime = debug.stageRuntime[stageId];
            const s = STATUS_STYLES[runtime?.status ?? 'idle'];
            return (
              <label
                key={stageId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 5,
                  paddingBottom: 5,
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={debug.enabledStages[stageId]}
                  onChange={(e) => debug.setStageEnabled(stageId, e.target.checked)}
                />
                <span style={{ color: s.color, width: 14 }}>{s.icon}</span>
                <span style={{ flex: 1, color: '#ccc' }}>{debug.stageConfig[stageId].label}</span>
                {runtime?.durationMs !== undefined && (
                  <span style={{ color: '#9fd6ff' }}>{runtime.durationMs}ms</span>
                )}
              </label>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}

export default DebugPanel;
