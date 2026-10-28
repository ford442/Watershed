/**
 * DevOverlays.tsx — the developer overlays, split out of App (#521 C1): the
 * `?debug=1` inspector (#485 C) and F/G/P/O hotkeys (#486 B), the
 * `?sweDebug=1` bed view (#374), and clean-test's "Show debug" button. App
 * fetches this one chunk only when one of those flags is set — a player never
 * pays for any of it.
 */
import { useCallback } from 'react';
import DebugPanel from '../components/DebugPanel';
import SWEBedDebugOverlay from '../components/SWEBedDebugOverlay';
import { persistRendererPreference, type RendererPreference } from '../rendering';
import { persistMaterialBackend, type MaterialBackend } from '../rendering/materialBackend';
import { setCleanTestMode } from '../utils/cleanTestMode';
import { useDebugHotkeys } from '../debug/useDebugHotkeys';
import type { DebugStageController } from '../debug/debugStages';
import type { RendererBootState } from '../boot/useRendererBoot';
import type { DevToggles } from './useDevToggles';

interface DevOverlaysProps {
  debug: DebugStageController;
  dev: DevToggles;
  boot: RendererBootState;
}

export default function DevOverlays({ debug, dev, boot }: DevOverlaysProps) {
  // F/G/P/O developer hotkeys exist only under ?debug=1 (#486 B): a player's
  // stray tap must never draw collider wireframes.
  const { setPhysicsDebug, setWireframeDebug } = dev;
  const togglePhysicsDebug = useCallback(() => setPhysicsDebug((prev) => !prev), [setPhysicsDebug]);
  const toggleWireframeDebug = useCallback(() => setWireframeDebug((prev) => !prev), [setWireframeDebug]);
  useDebugHotkeys(debug.debugEnabled && !dev.cleanTest, {
    togglePhysicsDebug,
    toggleWireframe: toggleWireframeDebug,
  });

  return (
    <>
      {dev.sweDebug && <SWEBedDebugOverlay />}
      {debug.debugEnabled && !dev.cleanTest && (
        <DebugPanel
          debug={debug}
          physicsDebug={dev.physicsDebug}
          onTogglePhysicsDebug={dev.setPhysicsDebug}
          rendererPreference={boot.rendererPreference}
          onRendererPreferenceChange={(next: RendererPreference) => {
            persistRendererPreference(next);
            boot.setRendererPreference(next);
          }}
          materialBackend={boot.materialBackend}
          onMaterialBackendChange={(next: MaterialBackend) => {
            persistMaterialBackend(next);
            boot.setMaterialBackend(next);
          }}
          wireframeDebug={dev.wireframeDebug}
          onToggleWireframeDebug={dev.setWireframeDebug}
          onEnableCleanTest={() => {
            setCleanTestMode(true);
            dev.setCleanTest(true);
            dev.setPhysicsDebug(false);
            dev.setWireframeDebug(false);
          }}
        />
      )}
      {dev.cleanTest && debug.debugEnabled && (
        <button
          type="button"
          onClick={() => {
            setCleanTestMode(false);
            dev.setCleanTest(false);
          }}
          style={{
            position: 'fixed',
            bottom: 12,
            right: 12,
            zIndex: 20000,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(10,10,16,0.85)',
            color: '#ccc',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Show debug
        </button>
      )}
    </>
  );
}
