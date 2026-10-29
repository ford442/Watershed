/**
 * RendererBoot.tsx — the game Canvas, built from the negotiated boot
 * (`useRendererBoot`), and the two renderer notices drawn over it (#521 C1).
 */
import React from 'react';
import { Canvas } from '@react-three/fiber';
import {
  BootHealthSentinel,
  canvasDprRange,
  createGameRenderer,
  isVisualCaptureMode,
  MaterialBackendFallbackError,
  recordBootFailure,
  RendererQualitySync,
  shadowModeToCanvasProp,
} from '../rendering';
import SafeGraphicsBadge from '../components/SafeGraphicsBadge';
import { isScriptedInputMode } from '../input/scriptedRun';
import type { RendererBootState } from './useRendererBoot';

interface RendererBootProps {
  boot: RendererBootState;
  /** Runs first when a renderer comes up (App's `visualization` debug stage). */
  onCreated?: () => void;
  children: React.ReactNode;
}

export function RendererBoot({ boot, onCreated, children }: RendererBootProps) {
  const { contextOptions, rendererPreference, materialBackend } = boot;
  return (
    <Canvas
      key={boot.canvasKey}
      dpr={canvasDprRange(contextOptions.dprMax)}
      gl={async (props) => {
        // No retry, no fallback ladder: the envelope in `contextOptions` is the
        // one the boot probe already proved this machine will grant, attribute
        // for attribute. A throw here is a genuine failure — record *why* for
        // the next boot, then let it reach the ErrorBoundary.
        try {
          return await createGameRenderer(
            {
              ...props,
              preserveDrawingBuffer: isVisualCaptureMode(),
            },
            {
              preference: rendererPreference,
              antialias: contextOptions.antialias,
              powerPreference: contextOptions.powerPreference,
              contextOptions,
              materialBackend,
            }
          );
        } catch (error) {
          // Not a GPU failure: TSL hosts were built before the node renderer
          // gave up. The session is pinned to glsl; changing the backend
          // changes the Canvas key, so the remount comes up GLSL end to end.
          if (error instanceof MaterialBackendFallbackError) {
            boot.setMaterialBackend('glsl');
            throw error;
          }
          recordBootFailure('renderer-throw');
          throw error;
        }
      }}
      camera={{ position: [0, 10, -10], fov: 75 }}
      shadows={shadowModeToCanvasProp(contextOptions.shadowMode)}
      frameloop={isScriptedInputMode() ? 'never' : 'always'}
      onCreated={({ gl }) => {
        onCreated?.();
        boot.attachRenderer(gl);
      }}
    >
      <RendererQualitySync />
      <BootHealthSentinel />
      <React.Suspense
        fallback={
          <mesh>
            <boxGeometry args={[0.5, 0.5, 0.5]} />
            <meshBasicMaterial color="#1a2a3a" />
          </mesh>
        }
      >
        {children}
      </React.Suspense>
    </Canvas>
  );
}

interface RendererBootNoticesProps {
  boot: RendererBootState;
  cleanTest: boolean;
}

/** The GPU-loss recovery toast and the Safe Graphics badge. */
export function RendererBootNotices({ boot, cleanTest }: RendererBootNoticesProps) {
  const { capability, previousFailure } = boot;
  return (
    <>
      {boot.webglRecovering && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 25000,
            padding: '10px 16px',
            borderRadius: 8,
            border: '1px solid rgba(255,200,80,0.35)',
            background: 'rgba(12,10,8,0.92)',
            color: '#f5e6c8',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 13,
            pointerEvents: 'none',
          }}
        >
          Graphics paused — recovering…
        </div>
      )}

      {/* Safe Graphics Mode — persistent, dismissible, acknowledgement
          persisted. Not a toast: see SafeGraphicsBadge. Hidden in clean-test
          and capture runs so it cannot land in a visual-smoke baseline. */}
      {!cleanTest && !isVisualCaptureMode() && capability.tier === 'degraded' && (
        <SafeGraphicsBadge
          reason={capability.reason}
          statusMessage={capability.statusMessage}
          bootFailure={previousFailure?.reason ?? null}
        />
      )}
    </>
  );
}
