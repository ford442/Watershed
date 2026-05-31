/**
 * AudioDiagnosticsOverlay.tsx
 *
 * DEV-only overlay that surfaces audio system state at a glance.
 * Mounted inside Experience.jsx's existing <Html> block.
 * Updates every 500 ms via setInterval (not useFrame) to avoid RAF budget.
 */

import React, { useEffect, useState } from 'react';
import { getAudioManager } from '../systems/AudioSystem';
import { useGameStore } from '../systems/GameState';

export type SegmentAudioPhase = 'meander' | 'approach' | 'waterfall' | 'splash' | 'pond' | 'rapids';

const PHASE_MAP: Record<number, SegmentAudioPhase> = {
  13: 'approach',
  14: 'waterfall',
  15: 'splash',
  16: 'pond',
  17: 'pond',
  18: 'pond',
};

function getPhase(segmentIndex: number): SegmentAudioPhase {
  if (segmentIndex <= 12) return 'meander';
  if (segmentIndex >= 19) return 'rapids';
  return PHASE_MAP[segmentIndex] ?? 'meander';
}

interface AudioState {
  contextState: string;
  loaded: number;
  total: number;
  failed: string[];
  active: { name: string; elapsed: number }[];
  phase: SegmentAudioPhase;
  volumes: { low: number; mid: number; high: number; rapids: number; whoosh: number; transition: number } | null;
  reverbActive: boolean;
  wallTightness: number;
}

function gatherAudioState(segmentIndex: number): AudioState {
  const manager = getAudioManager();
  const status = manager?.getLoadStatus();
  const active = manager?.getActiveSounds() ?? [];
  const audioState = manager?.getAudioState();
  const volumes = audioState?.layers ?? null;

  return {
    contextState: manager?.getAudioContextState() ?? 'none',
    loaded: status?.loaded ?? 0,
    total: status?.total ?? 23,
    failed: status?.failed ?? [],
    active,
    phase: getPhase(segmentIndex),
    volumes,
    reverbActive: audioState?.reverbActive ?? false,
    wallTightness: audioState?.wallTightness ?? 0,
  };
}

const AudioDiagnosticsOverlay: React.FC = () => {
  if (!import.meta.env.DEV) {
    return null;
  }

  const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
  const [state, setState] = useState<AudioState>(() => gatherAudioState(currentSegmentIndex));

  useEffect(() => {
    const id = setInterval(() => {
      setState(gatherAudioState(currentSegmentIndex));
    }, 500);
    return () => clearInterval(id);
  }, [currentSegmentIndex]);

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: '12px',
    right: '12px',
    width: '280px',
    background: 'rgba(0, 0, 0, 0.75)',
    color: '#e0e0e0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '12px',
    lineHeight: 1.4,
    padding: '12px',
    borderRadius: '8px',
    pointerEvents: 'none',
    zIndex: 9999,
    backdropFilter: 'blur(4px)',
  };

  const headerStyle: React.CSSProperties = {
    fontWeight: 600,
    fontSize: '13px',
    marginBottom: '8px',
    color: '#fff',
    borderBottom: '1px solid rgba(255,255,255,0.2)',
    paddingBottom: '4px',
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
  };

  const labelStyle: React.CSSProperties = {
    color: '#aaa',
  };

  const okStyle: React.CSSProperties = { color: '#7fff7f' };
  const warnStyle: React.CSSProperties = { color: '#ffcc00' };
  const errStyle: React.CSSProperties = { color: '#ff6666' };

  const ctxColor =
    state.contextState === 'running' ? okStyle : state.contextState === 'suspended' ? warnStyle : errStyle;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>🔊 Audio Diagnostics</div>

      <div style={rowStyle}>
        <span style={labelStyle}>Context</span>
        <span style={ctxColor}>{state.contextState}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Buffers</span>
        <span style={state.loaded === state.total ? okStyle : warnStyle}>
          {state.loaded} / {state.total}
        </span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Phase</span>
        <span>{state.phase}</span>
      </div>

      {state.failed.length > 0 && (
        <div style={{ marginTop: '6px' }}>
          <div style={{ ...labelStyle, marginBottom: '2px' }}>Failed loads:</div>
          <div style={{ maxHeight: '60px', overflowY: 'auto' }}>
            {state.failed.map((f) => (
              <div key={f} style={errStyle}>
                • {f}
              </div>
            ))}
          </div>
        </div>
      )}

      {state.active.length > 0 && (
        <div style={{ marginTop: '6px' }}>
          <div style={{ ...labelStyle, marginBottom: '2px' }}>Playing:</div>
          <div style={{ maxHeight: '60px', overflowY: 'auto' }}>
            {state.active.map((s, i) => (
              <div key={i} style={rowStyle}>
                <span>{s.name}</span>
                <span>{s.elapsed.toFixed(1)}s</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.volumes && (
        <div style={{ marginTop: '6px' }}>
          <div style={{ ...labelStyle, marginBottom: '2px' }}>Crossfade:</div>
          <div style={rowStyle}>
            <span>Low</span>
            <span>{state.volumes.low.toFixed(2)}</span>
          </div>
          <div style={rowStyle}>
            <span>Mid</span>
            <span>{state.volumes.mid.toFixed(2)}</span>
          </div>
          <div style={rowStyle}>
            <span>High</span>
            <span>{state.volumes.high.toFixed(2)}</span>
          </div>
          <div style={rowStyle}>
            <span>Rapids</span>
            <span>{state.volumes.rapids.toFixed(2)}</span>
          </div>
          <div style={rowStyle}>
            <span>Whoosh</span>
            <span>{state.volumes.whoosh.toFixed(2)}</span>
          </div>
          <div style={rowStyle}>
            <span>Transition</span>
            <span>{state.volumes.transition.toFixed(2)}</span>
          </div>
          <div style={rowStyle}>
            <span>Canyon Reverb</span>
            <span style={state.reverbActive ? okStyle : labelStyle}>
              {state.reverbActive ? `ON (${state.wallTightness.toFixed(2)})` : 'OFF'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default AudioDiagnosticsOverlay;
