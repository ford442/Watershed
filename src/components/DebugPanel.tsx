/**
 * DebugPanel — the `?debug=1` perf diagnostics panel.
 *
 * This file is the shell — the frame, the header (Clean / minimise) and the
 * section order; each section is its own component under `debugPanel/`
 * (#559 C) and subscribes to its own diagnostics store. The perf metrics feed
 * three sections, so they are read once here; the load-stage list's open
 * state is held here so it survives minimising.
 */
import React, { useState, useSyncExternalStore } from 'react';
import type { DebugStageController } from '../debug/debugStages';
import { getPerfMetrics, subscribePerfMetrics } from '../debug/perfMetrics';
import type { RendererPreference } from '../rendering/types';
import type { MaterialBackend } from '../rendering/materialBackend';
import { Divider } from './debugPanel/primitives';
import { GpuSection } from './debugPanel/GpuSection';
import { PhysicsWorkerSection } from './debugPanel/PhysicsWorkerSection';
import { MaterialsSection } from './debugPanel/MaterialsSection';
import { RendererSection } from './debugPanel/RendererSection';
import { PhysicsDebugSection } from './debugPanel/PhysicsDebugSection';
import { PhysicsStepSection } from './debugPanel/PhysicsStepSection';
import { FrameBudgetSection } from './debugPanel/FrameBudgetSection';
import { FillRateSection } from './debugPanel/FillRateSection';
import { LoadStagesSection } from './debugPanel/LoadStagesSection';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DebugPanelProps {
  debug: DebugStageController;
  physicsDebug?: boolean;
  onTogglePhysicsDebug?: (val: boolean) => void;
  rendererPreference?: RendererPreference;
  onRendererPreferenceChange?: (preference: RendererPreference) => void;
  /** #256 path A — which material implementation the scene builds. */
  materialBackend?: MaterialBackend;
  onMaterialBackendChange?: (backend: MaterialBackend) => void;
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
  rendererPreference = 'webgl',
  onRendererPreferenceChange,
  materialBackend = 'glsl',
  onMaterialBackendChange,
  wireframeDebug = false,
  onToggleWireframeDebug,
  onEnableCleanTest,
}: DebugPanelProps) {
  const [stagesOpen, setStagesOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // Subscribe to live perf metrics from PerfCheckpointMonitor (inside Canvas)
  const metrics = useSyncExternalStore(subscribePerfMetrics, getPerfMetrics);

  if (!debug.debugEnabled) return null;

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
          <GpuSection metrics={metrics} />
          <Divider />
          <PhysicsWorkerSection />
          <Divider />
          <MaterialsSection materialBackend={materialBackend} onMaterialBackendChange={onMaterialBackendChange} />
          <Divider />
          <RendererSection
            rendererPreference={rendererPreference}
            onRendererPreferenceChange={onRendererPreferenceChange}
          />
          <Divider />
          <PhysicsDebugSection
            physicsDebug={physicsDebug}
            onTogglePhysicsDebug={onTogglePhysicsDebug}
            wireframeDebug={wireframeDebug}
            onToggleWireframeDebug={onToggleWireframeDebug}
          />
          <Divider />
          <PhysicsStepSection />
          <Divider />
          <FrameBudgetSection metrics={metrics} />
          <Divider />
          <FillRateSection metrics={metrics} />
          <Divider />
          <LoadStagesSection debug={debug} stagesOpen={stagesOpen} setStagesOpen={setStagesOpen} />
        </>
      )}
    </div>
  );
}

export default DebugPanel;
