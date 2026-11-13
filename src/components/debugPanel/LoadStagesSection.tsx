/**
 * Load stages (collapsible): each debug stage's toggle, status and duration
 * (#559 C, from `DebugPanel.tsx`). The open state is the panel's, so it
 * survives minimising.
 */
import React from 'react';
import type { DebugStageController, DebugStageId, DebugStageStatus } from '../../debug/debugStages';

const STATUS_STYLES: Record<DebugStageStatus, { icon: string; color: string }> = {
  idle:     { icon: '○', color: '#9e9e9e' },
  loading:  { icon: '⏳', color: '#f5c542' },
  success:  { icon: '✓', color: '#6dde7a' },
  failure:  { icon: '✗', color: '#ff6b6b' },
  disabled: { icon: '—', color: '#6f6f6f' },
};

export function LoadStagesSection({
  debug,
  stagesOpen,
  setStagesOpen,
}: {
  debug: DebugStageController;
  stagesOpen: boolean;
  setStagesOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const stageIds = Object.keys(debug.stageConfig) as DebugStageId[];
  const failCount = stageIds.filter(
    (id) => debug.stageRuntime[id]?.status === 'failure'
  ).length;

  return (
    <>
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
  );
}
