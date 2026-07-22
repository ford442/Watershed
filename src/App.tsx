import React, { useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import Experience from './Experience';
import { Loader } from './components/Loader';
import { StartMenu } from './components/StartMenu';
import { PauseMenu } from './components/PauseMenu';
import DebugPanel from './components/DebugPanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { SettingsSync } from './ui/SettingsSync';
import { rehydrateSettings } from './systems/useSettingsStore';
import { useDebugStages } from './debug/debugStages';
import { isCleanTestMode, setCleanTestMode } from './utils/cleanTestMode';
import ErrorBoundary from './components/ErrorBoundary';
import meadowToWaterfall from './maps/meander_to_waterfall.json';
import {
  createGameRenderer,
  parseRendererPreference,
  persistRendererPreference,
  type RendererPreference,
} from './rendering';
import './style.css';
import { initPersistence, hydrateStoreForRun } from './systems/persistenceBootstrap';
import { getActiveRunKey, getActiveMapId } from './utils/runContext';
import { useGameStore } from './systems/GameState';
import type { MapRegistryId } from './maps/registry';
import { syncMapUrl } from './maps/campaign';
import { setLastMapId } from './systems/PersistenceSystem';

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
  /** Heavy Physics/track mount — deferred after Start so the menu can unmount first. */
  const [worldEnabled, setWorldEnabled] = useState(false);
  const [skipLoader, setSkipLoader] = useState(false);
  const debug = useDebugStages();
  const [selectedMapId, setSelectedMapId] = useState<MapRegistryId>(() => getActiveMapId());
  const [cleanTest, setCleanTestActive] = useState(() => isCleanTestMode());
  const [physicsDebug, setPhysicsDebug] = useState(() => {
    if (isCleanTestMode()) return false;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('physicsDebug');
    return raw === '1' || raw === 'true';
  });
  const [rendererPreference, setRendererPreference] = useState<RendererPreference>(() =>
    parseRendererPreference()
  );
  const [wireframeDebug, setWireframeDebug] = useState(() => {
    if (isCleanTestMode()) return false;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('wireframe');
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
    initPersistence(getActiveRunKey(selectedMapId));
    syncMapUrl(selectedMapId);
  }, []);

  // Client-only rehydration of persisted settings (skipHydration in the store).
  // Flips `_hasHydrated`, which gates the panel + all setting application.
  useEffect(() => {
    rehydrateSettings();
  }, []);

  const handleSelectMap = useCallback((mapId: MapRegistryId) => {
    setSelectedMapId(mapId);
    syncMapUrl(mapId);
    setLastMapId(mapId);
    hydrateStoreForRun(getActiveRunKey(mapId));
  }, []);

  const handleMapChange = useCallback((mapId: MapRegistryId) => {
    setSelectedMapId(mapId);
    syncMapUrl(mapId);
    setLastMapId(mapId);
    hydrateStoreForRun(getActiveRunKey(mapId));
  }, []);

  useEffect(() => {
    useGameStore.getState().setIsPaused(phase === 'paused' || phase === 'menu');
  }, [phase]);

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
    const params = new URLSearchParams(window.location.search);
    if (wireframeDebug) {
      params.set('wireframe', '1');
    } else {
      params.delete('wireframe');
    }
    const next = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
  }, [wireframeDebug]);

  const handleRendererPreferenceChange = useCallback((next: RendererPreference) => {
    persistRendererPreference(next);
    setRendererPreference(next);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.repeat) return;
      if (cleanTest) return;
      if (e.code === 'KeyF') {
        setPhysicsDebug((prev) => !prev);
      }
      if (e.code === 'KeyG') {
        setWireframeDebug((prev) => !prev);
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
  }, [cleanTest]);

  useEffect(() => {
    if (!cleanTest) return;
    setPhysicsDebug(false);
    setWireframeDebug(false);
  }, [cleanTest]);

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

  const requestPointerLockSafely = useCallback(() => {
    if (window.location.search.includes('no-pointer-lock')) return;
    // Canvas may already be locked (e.g. PointerLockControls' own lockOnClick
    // handler beat us to it), or detached/swapped (renderer preference change
    // remounts the Canvas with a new key). Guard both to avoid the
    // WrongDocumentError/unhandled rejection that requestPointerLock throws
    // for a stale or already-locked element.
    if (document.pointerLockElement) return;
    const canvas = document.querySelector('canvas');
    if (!canvas || !canvas.isConnected) return;
    try {
      canvas.requestPointerLock()?.catch((err: unknown) => {
        console.warn('[App] Pointer lock failed:', err);
      });
    } catch (err) {
      console.warn('[App] Pointer lock failed:', err);
    }
  }, []);

  const handleStart = useCallback(
    (mapId: MapRegistryId = selectedMapId) => {
      handleSelectMap(mapId);
      setPhase('playing');
      // Defer world mount by two frames so StartMenu can unmount and paint
      // before Rapier + 7 track segments block the main thread.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setWorldEnabled(true);
        });
      });
      requestPointerLockSafely();
    },
    [handleSelectMap, requestPointerLockSafely, selectedMapId],
  );

  const handleResume = useCallback(() => {
    setPhase('playing');
    requestPointerLockSafely();
  }, [requestPointerLockSafely]);

  const handleRestart = useCallback(() => {
    window.location.reload();
  }, []);

  const handleQuit = useCallback(() => {
    setWorldEnabled(false);
    setPhase('menu');
  }, []);

  const handleReturnToMenu = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    setWorldEnabled(false);
    setPhase('menu');
  }, []);

  // Enter starts from the menu with the selected map.
  useEffect(() => {
    if (phase !== 'menu') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        handleStart(selectedMapId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStart, phase, selectedMapId]);

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
          <SettingsSync />
          <Canvas
            key={`renderer-${rendererPreference}`}
            gl={async (props) =>
              createGameRenderer(
                {
                  ...props,
                  preserveDrawingBuffer:
                    urlParams.get('screenshot') === '1' || urlParams.get('capture') === '1',
                },
                {
                  preference: rendererPreference,
                  antialias: true,
                  powerPreference: 'high-performance',
                }
              )
            }
            camera={{ position: [0, 10, -10], fov: 75 }}
            shadows="soft"
            frameloop="always"
            onCreated={() => {
              debug.runStage('visualization', () => undefined);
            }}
          >
            <React.Suspense
              fallback={
                <mesh>
                  <boxGeometry args={[0.5, 0.5, 0.5]} />
                  <meshBasicMaterial color="#1a2a3a" />
                </mesh>
              }
            >
              <Experience
                debug={debug}
                physicsDebug={physicsDebug}
                rendererPreference={rendererPreference}
                wireframeDebug={wireframeDebug}
                cleanTest={cleanTest}
                worldEnabled={worldEnabled}
                mapId={selectedMapId}
                onMapChange={handleMapChange}
                onReturnToMenu={handleReturnToMenu}
              />
            </React.Suspense>
          </Canvas>

          {/* Asset loading overlay */}
          {debug.isStageEnabled('uiOverlay') && !skipLoader && <Loader />}

          {/* Goal 4: Start Menu — shown before first run */}
          {debug.isStageEnabled('uiOverlay') && phase === 'menu' && !settingsOpen && (
            <StartMenu
              onStart={handleStart}
              selectedMapId={selectedMapId}
              onSelectMap={handleSelectMap}
              onOpenOptions={() => setSettingsOpen(true)}
            />
          )}
          {/* Goal 4: Pause Menu — shown when pointer lock is lost during play */}
          {debug.isStageEnabled('uiOverlay') && phase === 'paused' && !settingsOpen && (
            <PauseMenu
              onResume={handleResume}
              onRestart={handleRestart}
              onQuit={handleQuit}
              onOpenOptions={() => setSettingsOpen(true)}
            />
          )}
          {/* Options — reachable from StartMenu and PauseMenu. Rendered in the
              unlocked (menu/paused) state so key/mouse capture never fights
              pointer lock. Closing returns to the parent menu; from the pause
              menu that lands on RESUME, which re-locks on the user's click. */}
          {debug.isStageEnabled('uiOverlay') && settingsOpen && (phase === 'menu' || phase === 'paused') && (
            <div className="settings-panel-overlay">
              <SettingsPanel onClose={() => setSettingsOpen(false)} />
            </div>
          )}
          {debug.debugEnabled && !cleanTest && (
            <DebugPanel
              debug={debug}
              physicsDebug={physicsDebug}
              onTogglePhysicsDebug={setPhysicsDebug}
              rendererPreference={rendererPreference}
              onRendererPreferenceChange={handleRendererPreferenceChange}
              wireframeDebug={wireframeDebug}
              onToggleWireframeDebug={setWireframeDebug}
              onEnableCleanTest={() => {
                setCleanTestMode(true);
                setCleanTestActive(true);
                setPhysicsDebug(false);
                setWireframeDebug(false);
              }}
            />
          )}
          {cleanTest && debug.debugEnabled && (
            <button
              type="button"
              onClick={() => {
                setCleanTestMode(false);
                setCleanTestActive(false);
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
      )}
    </ErrorBoundary>
  );
}

export default App;
