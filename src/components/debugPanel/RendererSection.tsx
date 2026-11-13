/**
 * Renderer — WebGL2 (WebGPU experimental / no-op): the active renderer, the
 * adaptive render-scale valve, the preference toggle (#559 C, from
 * `DebugPanel.tsx`).
 */
import React, { useSyncExternalStore } from 'react';
import { getRendererDiagnostics, subscribeRendererDiagnostics } from '../../rendering/rendererState';
import type { RendererPreference } from '../../rendering/types';
import { useQualityPreset, useRenderScale } from '../../systems/GameState';
import { RENDER_SCALE_MAX } from '../../rendering/renderScale';
import { canvasDprRange, deriveRendererContextOptions } from '../../rendering/deriveRendererContextOptions';
import { MetricRow, SectionTitle } from './primitives';

export function RendererSection({
  rendererPreference,
  onRendererPreferenceChange,
}: {
  rendererPreference: RendererPreference;
  onRendererPreferenceChange?: (preference: RendererPreference) => void;
}) {
  const qualityPreset = useQualityPreset();
  const renderScale = useRenderScale();
  const rendererDiagnostics = useSyncExternalStore(subscribeRendererDiagnostics, getRendererDiagnostics);

  return (
    <>
      <SectionTitle>Renderer — WebGL2 (WebGPU experimental / no-op)</SectionTitle>
      <div style={{ marginBottom: 6, color: '#d0d0d0' }}>
        Active: <span style={{ color: '#9fd6ff' }}>{rendererDiagnostics.rendererName}</span>
      </div>
      {/* The valve is the only graphics knob that moves on its own while the
          player is not looking at a menu — make it legible. */}
      <MetricRow
        label="Render scale"
        value={`${renderScale.toFixed(2)}x · DPR ≤ ${
          canvasDprRange(
            deriveRendererContextOptions(qualityPreset, {
              devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
              renderScale,
            }).dprMax,
          )[1]
        } (${qualityPreset})`}
        t={renderScale >= RENDER_SCALE_MAX ? 'ok' : 'warn'}
        hint="adaptive valve closed — frame time is over budget, resolution traded for headroom"
      />
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
        URL: <code>?renderer=webgl</code> (live) or <code>?renderer=webgpu</code> (falls back to WebGL2)
      </div>
    </>
  );
}
