import React from 'react';
import { DebugStageController, DebugStageId, DebugStageStatus } from '../debug/debugStages';

const STATUS_STYLES: Record<DebugStageStatus, { icon: string; color: string }> = {
  idle: { icon: '○', color: '#9e9e9e' },
  loading: { icon: '⏳', color: '#f5c542' },
  success: { icon: '✓', color: '#6dde7a' },
  failure: { icon: '✗', color: '#ff6b6b' },
  disabled: { icon: '—', color: '#6f6f6f' },
};

interface DebugPanelProps {
  debug: DebugStageController;
}

export function DebugPanel({ debug }: DebugPanelProps) {
  if (!debug.debugEnabled) return null;

  const stageIds = Object.keys(debug.stageConfig) as DebugStageId[];

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 20000,
        background: 'rgba(12, 12, 18, 0.9)',
        color: '#f1f1f1',
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid rgba(120, 180, 255, 0.45)',
        width: 290,
        maxHeight: '70vh',
        overflowY: 'auto',
        boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        pointerEvents: 'auto',
      }}
      aria-label="Debug Stages Panel"
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>DEBUG STAGES (?debug=1)</div>
      {stageIds.map((stageId) => {
        const runtime = debug.stageRuntime[stageId];
        const style = STATUS_STYLES[runtime.status] ?? STATUS_STYLES.idle;

        return (
          <label
            key={stageId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
              paddingBottom: 6,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <input
              type="checkbox"
              checked={debug.enabledStages[stageId]}
              onChange={(e) => debug.setStageEnabled(stageId, e.target.checked)}
            />
            <span style={{ color: style.color, width: 16 }}>{style.icon}</span>
            <span style={{ flex: 1 }}>{debug.stageConfig[stageId].label}</span>
            {runtime.durationMs !== undefined && (
              <span style={{ color: '#9fd6ff' }}>{runtime.durationMs}ms</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

export default DebugPanel;

