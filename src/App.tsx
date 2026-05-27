import React, { useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import Experience from './Experience';
import { Loader } from './components/Loader';
import { StartMenu } from './components/StartMenu';
import { PauseMenu } from './components/PauseMenu';
import DebugPanel from './components/DebugPanel';
import { useDebugStages } from './debug/debugStages';
import ErrorBoundary from './components/ErrorBoundary';
import meadowToWaterfall from './maps/meander_to_waterfall.json';
import './style.css';

// ---------------------------------------------------------------------------
// Editor mode — ?editor=1 in dev only
// ---------------------------------------------------------------------------
// NOTE: URLSearchParams is evaluated at module load time (static), so
// isEditorMode is a constant for the lifetime of the page.
const urlParams = new URLSearchParams(window.location.search);
const isEditorMode =
  typeof import.meta !== 'undefined' &&
  (import.meta as any).env?.DEV === true &&
  urlParams.get('editor') === '1';

/** Game phase determines which overlays are visible */
type GamePhase = 'menu' | 'playing' | 'paused';

// Simple fallback scene if Experience fails
const FallbackScene = () => {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#444444" />
    </mesh>
  );
};

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  const role = el.getAttribute('role');
  return (
    el.isContentEditable ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    role === 'textbox' ||
    role === 'searchbox'
  );
};

function App() {
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [skipLoader, setSkipLoader] = useState(false);
  const debug = useDebugStages();
  const [physicsDebug, setPhysicsDebug] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('physicsDebug');
    return raw === '1' || raw === 'true';
  });

  // Dynamic import for editor — keeps LevelEditor out of the production bundle.
  const [EditorComponent, setEditorComponent] =
    useState<React.ComponentType<{ initialLevelData?: any }> | null>(null);

  useEffect(() => {
    if (isEditorMode) {
      import('./components/LevelEditor')      // resolves via index.ts barrel
        .then((m) => setEditorComponent(() => m.LevelEditor))
        .catch((err) => console.error('[App] Failed to load LevelEditor:', err));
    }
  }, []);

  useEffect(() => {
    debug.runStage('appBootstrap', () => {
      if (window.location.search.includes('no-pointer-lock')) {
        setSkipLoader(true);
      }
    });
  }, [debug.runStage]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (physicsDebug) {
      params.set('physicsDebug', '1');
    } else {
      params.delete('physicsDebug');
    }
    const next = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
  }, [physicsDebug]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.repeat) return;
      if (e.code === 'KeyF') {
        setPhysicsDebug((prev) => !prev);
      }
      if (e.code === 'KeyP') {
        const snapshot = (window as any).__watershedPhysicsDebug;
        if (snapshot) {
          console.info('[PhysicsDebug] Snapshot', snapshot);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Detect pointer lock loss as pause trigger
  useEffect(() => {
    if (!debug.isStageEnabled('uiOverlay')) return;
    debug.setStageLoading('uiOverlay');
    try {
      const handlePointerLockChange = () => {
        try {
          const locked = !!document.pointerLockElement;
          setPhase((prev) => {
            if (locked && prev === 'paused') return 'playing';
            if (!locked && prev === 'playing') return 'paused';
            return prev;
          });
        } catch (error) {
          debug.setStageFailure('uiOverlay', error);
        }
      };

      document.addEventListener('pointerlockchange', handlePointerLockChange);
      debug.setStageSuccess('uiOverlay');
      return () => document.removeEventListener('pointerlockchange', handlePointerLockChange);
    } catch (error) {
      debug.setStageFailure('uiOverlay', error);
    }
  }, [debug.isStageEnabled, debug.setStageFailure, debug.setStageLoading, debug.setStageSuccess]);

  const handleStart = useCallback(() => {
    setPhase('playing');
    if (!window.location.search.includes('no-pointer-lock')) {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        canvas.requestPointerLock().catch((err) => {
          console.warn('[App] Pointer lock failed:', err);
        });
      }
    }
  }, []);

  const handleResume = useCallback(() => {
    setPhase('playing');
    if (!window.location.search.includes('no-pointer-lock')) {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        canvas.requestPointerLock().catch((err) => {
          console.warn('[App] Pointer lock failed:', err);
        });
      }
    }
  }, []);

  const handleRestart = useCallback(() => {
    window.location.reload();
  }, []);

  const handleQuit = useCallback(() => {
    setPhase('menu');
  }, []);

  return (
    <ErrorBoundary>
      {/* Editor mode: full-page swap, own Canvas, own lifecycle */}
      {isEditorMode ? (
        EditorComponent ? (
          <EditorComponent initialLevelData={meadowToWaterfall} />
        ) : (
          <div style={{
            width: '100vw', height: '100vh',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui',
          }}>
            Loading editor…
          </div>
        )
      ) : (
        <>
          <Canvas
            gl={{
              powerPreference: 'high-performance',
              antialias: true,
            }}
            camera={{ position: [0, 10, -10], fov: 75 }}
            shadows
            frameloop="always"
            onCreated={() => {
              debug.runStage('visualization', () => undefined);
            }}
          >
            <React.Suspense fallback={null}>
              <Experience debug={debug} physicsDebug={physicsDebug} />
            </React.Suspense>
          </Canvas>

          {/* Asset loading overlay */}
          {debug.isStageEnabled('uiOverlay') && !skipLoader && <Loader />}

          {/* Goal 4: Start Menu — shown before first run */}
          {debug.isStageEnabled('uiOverlay') && phase === 'menu' && <StartMenu onStart={handleStart} />}

          {/* Goal 4: Pause Menu — shown when pointer lock is lost during play */}
          {debug.isStageEnabled('uiOverlay') && phase === 'paused' && (
            <PauseMenu
              onResume={handleResume}
              onRestart={handleRestart}
              onQuit={handleQuit}
            />
          )}
          <DebugPanel debug={debug} physicsDebug={physicsDebug} onTogglePhysicsDebug={setPhysicsDebug} />
        </>
      )}
    </ErrorBoundary>
  );
}

export default App;
