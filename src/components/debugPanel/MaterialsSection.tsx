/**
 * Materials — GLSL (live) / TSL (migration): the active backend and the
 * toggle (#256 path A; #559 C, from `DebugPanel.tsx`).
 */
import React, { useSyncExternalStore } from 'react';
import { getRendererDiagnostics, subscribeRendererDiagnostics } from '../../rendering/rendererState';
import {
  MATERIAL_BACKEND_REASON_LABELS,
  requestedMaterialBackend,
  type MaterialBackend,
} from '../../rendering/materialBackend';
import { MetricRow, SectionTitle } from './primitives';

export function MaterialsSection({
  materialBackend,
  onMaterialBackendChange,
}: {
  materialBackend: MaterialBackend;
  onMaterialBackendChange?: (backend: MaterialBackend) => void;
}) {
  const rendererDiagnostics = useSyncExternalStore(subscribeRendererDiagnostics, getRendererDiagnostics);
  // Re-read on every diagnostics change: a renderer fallback pins the session
  // to glsl just before it publishes `materialBackend: 'glsl'`.
  const requestedBackend = requestedMaterialBackend();

  return (
    <>
      <SectionTitle>Materials — GLSL (live) / TSL (migration)</SectionTitle>
      <MetricRow
        label="Active backend"
        value={rendererDiagnostics.materialBackend}
        t={rendererDiagnostics.materialBackend === requestedBackend.backend ? 'ok' : 'warn'}
        hint={
          rendererDiagnostics.materialBackend === requestedBackend.backend
            ? MATERIAL_BACKEND_REASON_LABELS[requestedBackend.reason]
            : 'requested TSL but the node renderer or material could not be built'
        }
      />
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {(['glsl', 'tsl'] as MaterialBackend[]).map((backend) => (
          <button
            key={backend}
            type="button"
            onClick={() => onMaterialBackendChange?.(backend)}
            style={{
              flex: 1,
              padding: '4px 6px',
              borderRadius: 4,
              border: materialBackend === backend
                ? '1px solid #6dde7a'
                : '1px solid rgba(255,255,255,0.18)',
              background: materialBackend === backend
                ? 'rgba(109,222,122,0.15)'
                : 'rgba(255,255,255,0.04)',
              color: materialBackend === backend ? '#6dde7a' : '#ccc',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
            }}
          >
            {backend.toUpperCase()}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 6 }}>
        URL: <code>?material=glsl</code> (live) or <code>?material=tsl</code> (NodeMaterial;
        remounts the Canvas onto WebGPURenderer with a WebGL2 backend)
      </div>
    </>
  );
}
