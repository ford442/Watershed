import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import Experience from './Experience';
import { Loader } from './components/Loader';
import { useProgress } from '@react-three/drei';
import { StartMenu } from './components/StartMenu';
import { isSWEDebugEnabled } from './components/sweDebugFlag';
import { lazyComponent } from './utils/lazyComponent';
import { whenIdle } from './utils/whenIdle';
import { preloadEnvironmentExtras } from './components/Environment/lazyExtras';
import { SettingsSync } from './ui/SettingsSync';
import { rehydrateSettings, useSettingsStore } from './systems/settings/useSettingsStore';
import { useDebugStages } from './debug/debugStages';
import { useDebugHotkeys } from './debug/useDebugHotkeys';
import { isCleanTestMode, setCleanTestMode } from './utils/cleanTestMode';
import ErrorBoundary from './components/ErrorBoundary';
import meadowToWaterfall from './maps/meander_to_waterfall.json';
import {
  beginBootAttempt,
  BootHealthSentinel,
  createGameRenderer,
  canvasDprRange,
  deriveRendererContextOptions,
  isSoftwareRendererAllowed,
  isVisualCaptureMode,
  negotiateBootGraphics,
  parseRendererPreference,
  persistRendererPreference,
  buildCanvasIdentityKey,
  recordBootFailure,
  RendererQualitySync,
  shadowModeToCanvasProp,
  type BootFailureRecord,
  type GraphicsCapability,
  type RendererPreference,
} from './rendering';
import GraphicsUnsupported from './components/GraphicsUnsupported';
import SafeGraphicsBadge from './components/SafeGraphicsBadge';
import {
  persistMaterialBackend,
  resolveMaterialBackend,
  type MaterialBackend,
} from './rendering/materialBackend';
import { attachGpuLossHandlers, isGpuLossDebugEnabled, simulateGpuLoss } from './rendering/gpuLossRecovery';
import './style.css';
import { initPersistence, hydrateStoreForRun } from './systems/persistence/persistenceBootstrap';
import { getActiveRunKey, getActiveMapId } from './utils/runContext';
import { useGameStore, useQualityPreset, useRenderScale } from './systems/GameState';
import type { MapRegistryId } from './maps/registry';
import { syncMapUrl } from './maps/campaign';
import { setLastMapId, getLaunchHour } from './systems/persistence/PersistenceSystem';
import { initRunSession } from './systems/journey/runSession';
import { resolveInitialVehicle } from './experience/hooks/useInnerExperience';
import { prefetchRaftVehicle } from './vehicles/raftVehicleChunk';

// Menus and overlays that only mount on a user action or a flag stay out of the entry chunk.
// `preloadOverlays` (idle, once the app is up) fetches the two a player is likely to open, so
// the first PAUSE / OPTIONS click finds them loaded instead of suspending.
const PauseMenuChunk = lazyComponent(() => import('./components/PauseMenu'));
const SettingsPanelChunk = lazyComponent(() => import('./ui/SettingsPanel'));
const SWEBedDebugOverlayChunk = lazyComponent(() => import('./components/SWEBedDebugOverlay'));
const PauseMenu = PauseMenuChunk.Component;
const SettingsPanel = SettingsPanelChunk.Component;
const SWEBedDebugOverlay = SWEBedDebugOverlayChunk.Component;
// Touch devices only (#486 C): everyone else never fetches the on-screen controls.
const TouchControlsChunk = lazyComponent(() => import('./components/TouchControls'));
const TouchControls = TouchControlsChunk.Component;
function preloadOverlays() {
  PauseMenuChunk.preload();
  SettingsPanelChunk.preload();
  if (isTouchInputMode()) TouchControlsChunk.preload();
  // Fauna / biome props / set pieces (Environment/extras.ts) a segment mounts after the menu.
  preloadEnvironmentExtras();
}
import { isScriptedInputMode } from './input/scriptedRun';
import { onPauseRequest } from './input/pauseBus';
import { useInputStore } from './input/InputHub';
import { isTouchInputMode } from './input/touchMode';
import { stopHaptics } from './input/haptics';

// #485 C: the inspector is `?debug=1` only — a player never pays for its ~700 lines.
const DebugPanel = React.lazy(() => import('./components/DebugPanel'));

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

/**
 * The result of boot-time graphics negotiation, plus the boot-crash verdict.
 *
 * Both are session facts, decided once, *before* anything mounts — see
 * `probeGraphicsCapability.ts` and `bootCrashGuard.ts`.
 */
export interface GraphicsBoot {
  capability: GraphicsCapability;
  /** What the previous start left behind, or null when it drew a frame. */
  previousFailure: BootFailureRecord | null;
}

let negotiatedBoot: GraphicsBoot | null = null;

/**
 * Negotiate once per page load.
 *
 * Memoised at module scope rather than in a `useState` initializer because
 * `beginBootAttempt()` has a side effect that must happen exactly once: a second
 * call would read back the record this one just armed and misreport a healthy
 * boot as a crashed one.
 */
function resolveGraphicsBoot(): GraphicsBoot {
  if (negotiatedBoot) return negotiatedBoot;
  const previousFailure = beginBootAttempt();
  negotiatedBoot = {
    previousFailure,
    capability: negotiateBootGraphics({
      // The capture harness pins its envelope instead of probing — see
      // CAPTURE_ENVELOPE.
      captureMode: isSoftwareRendererAllowed(),
      previousBootFailed: previousFailure !== null,
    }),
  };
  return negotiatedBoot;
}

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

export interface AppProps {
  /** Test seam: pre-negotiated graphics boot. Production negotiates its own. */
  graphicsBoot?: GraphicsBoot;
}

function App({ graphicsBoot }: AppProps = {}) {
  // Before <Canvas>, before <Physics>, before anything mounts.
  const [{ capability: graphicsCapability, previousFailure }] = useState<GraphicsBoot>(
    () => graphicsBoot ?? resolveGraphicsBoot()
  );
  const [phase, setPhase] = useState<GamePhase>('menu');
  /** Heavy Physics/track mount — deferred after Start so the menu can unmount first. */
  const [worldEnabled, setWorldEnabled] = useState(false);
  const [skipLoader, setSkipLoader] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(settingsOpen);
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);
  const debug = useDebugStages();
  const [selectedMapId, setSelectedMapId] = useState<MapRegistryId>(() => getActiveMapId());
  useEffect(() => whenIdle(preloadOverlays), []);
  // The raft is its own chunk: a map that starts on it fetches it while the menu is up.
  useEffect(() => {
    if (resolveInitialVehicle(selectedMapId) === 'raft') prefetchRaftVehicle();
  }, [selectedMapId]);
  const [activeLaunchHour, setActiveLaunchHour] = useState(() => getLaunchHour());
  const [cleanTest, setCleanTestActive] = useState(() => isCleanTestMode());
  const [physicsDebug, setPhysicsDebug] = useState(() => {
    if (isCleanTestMode()) return false;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('physicsDebug');
    return raw === '1' || raw === 'true';
  });
  // #374 Phase 2: false-color view of the sampled SWE bed. URL-only, no
  // DebugPanel toggle — it is a simulation inspector, not a play setting.
  const [sweDebug] = useState(() => !isCleanTestMode() && isSWEDebugEnabled());
  const [rendererPreference, setRendererPreference] = useState<RendererPreference>(() =>
    parseRendererPreference()
  );
  // #256 path A: which material implementation the scene builds. Changing it
  // remounts the Canvas, because the renderer class itself depends on it.
  const [materialBackend, setMaterialBackend] = useState<MaterialBackend>(
    () => resolveMaterialBackend().backend
  );
  const qualityPreset = useQualityPreset();
  const renderScale = useRenderScale();
  const { active: assetsLoading } = useProgress();
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [canvasReady, setCanvasReady] = useState(false);
  const bootReady = canvasReady && !assetsLoading;
  const [webglRecovering, setWebglRecovering] = useState(false);
  // The live canvas's GPU-loss listeners/hooks (gpuLossRecovery.ts); detached
  // when the next renderer comes up and when App unmounts.
  const detachGpuLoss = useRef<(() => void) | null>(null);
  useEffect(() => () => detachGpuLoss.current?.(), []);
  const rendererContextOptions = deriveRendererContextOptions(qualityPreset, {
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    // Frozen at boot. Antialias, power preference, and the caveat flag are
    // creation-time attributes; taking them from the negotiated envelope instead
    // of the preset is what makes every preset share one Canvas key.
    envelope: graphicsCapability.envelope,
    // #419 phase C: LODManager's frame-time valve, multiplying the preset's DPR
    // ceiling. It moves the `dpr` prop below and nothing else — the Canvas key
    // is derived from creation attributes only, so closing the valve mid-run
    // cannot remount the Canvas any more than a preset change can.
    renderScale,
  });
  // Only creation-time context attributes belong in the Canvas key, and none of
  // them varies with quality any more. DPR, shadow mode, and shadow map size are
  // re-applied live by RendererQualitySync + SceneLighting, so *any* preset
  // change mid-run — low ↔ ultra included — keeps Rapier, the track treadmill,
  // WASM SWE grids, audio, and the vehicle body alive.
  const canvasKey = buildCanvasIdentityKey({
    rendererPreference,
    materialBackend,
    contextOptions: rendererContextOptions,
    epoch: canvasEpoch,
  });
  // The previous start never drew a frame, lost its context, or threw out of the
  // renderer factory (see bootCrashGuard). Clamp to `low` once settings have
  // hydrated — earlier and rehydration would put the persisted preset straight
  // back. Written to the *settings* store because SettingsSync owns the
  // settings → GameState direction and would otherwise re-push the old value;
  // the badge says what happened and how to raise it again.
  const settingsHydrated = useSettingsStore((state) => state._hasHydrated);
  const crashClampApplied = useRef(false);
  useEffect(() => {
    if (!previousFailure || !settingsHydrated || crashClampApplied.current) return;
    crashClampApplied.current = true;
    useSettingsStore.getState().setQuality('low');
    useGameStore.getState().setSettings({ quality: 'low' });
  }, [previousFailure, settingsHydrated]);

  // A software / flagged-driver context ('caveat') is the machine that cannot
  // afford `high`: the adaptive valve needs minutes there, so start at `low`
  // instead. Session-only — it touches GameState but not the persisted settings,
  // so a good GPU on a later load keeps the player's own preset. The settings
  // panel still applies a deliberate change (SettingsSync fires on change only).
  const caveatClampApplied = useRef(false);
  const isCaveatBoot =
    graphicsCapability.tier === 'degraded' && graphicsCapability.reason === 'caveat';
  useEffect(() => {
    if (!isCaveatBoot || !settingsHydrated || caveatClampApplied.current) return;
    caveatClampApplied.current = true;
    useGameStore.getState().setSettings({ quality: 'low' });
  }, [isCaveatBoot, settingsHydrated]);

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
    setCanvasReady(false);
  }, [canvasEpoch]);

  useEffect(() => {
    initPersistence(getActiveRunKey(selectedMapId));
    syncMapUrl(selectedMapId);
  }, []);

  // Client-only rehydration of persisted settings (skipHydration in the store).
  // Flips `_hasHydrated`, which gates the panel + all setting application.
  useEffect(() => {
    rehydrateSettings();
  }, []);

  // Handheld envelope (#486 C): viewport + HUD scale as CSS variables, touch-action: none.
  const touchMode = isTouchInputMode();
  useEffect(() => {
    if (!touchMode) return undefined;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    void import('./input/handheld').then((m) => {
      if (!cancelled) dispose = m.applyHandheldEnvelope();
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [touchMode]);

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

  const handleMaterialBackendChange = useCallback((next: MaterialBackend) => {
    persistMaterialBackend(next);
    setMaterialBackend(next);
  }, []);

  // F/G/P/O developer hotkeys exist only under ?debug=1 (#486 B): a player's
  // stray tap must never draw collider wireframes.
  const togglePhysicsDebug = useCallback(() => setPhysicsDebug((prev) => !prev), []);
  const toggleWireframeDebug = useCallback(() => setWireframeDebug((prev) => !prev), []);
  useDebugHotkeys(debug.debugEnabled && !cleanTest, {
    togglePhysicsDebug,
    toggleWireframe: toggleWireframeDebug,
  });

  useEffect(() => {
    if (!cleanTest) return;
    setPhysicsDebug(false);
    setWireframeDebug(false);
  }, [cleanTest]);

  // The one PAUSE consumer (#486 B). A gamepad's Start and the touch Pause button
  // arrive as the hub's PAUSE bit; Escape pauses a player who is not holding
  // pointer lock (with lock, the browser eats Escape and `pointerlockchange`
  // below does the pausing). Resume is each menu's own job.
  useEffect(() => {
    const pause = () => {
      if (isScriptedInputMode()) return;
      if (document.pointerLockElement) document.exitPointerLock();
      stopHaptics();
      setPhase((prev) => (prev === 'playing' ? 'paused' : prev));
    };
    const offBus = onPauseRequest(pause);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !e.repeat && !document.pointerLockElement) pause();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      offBus();
      window.removeEventListener('keydown', onKeyDown);
    };
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
            // Don't auto-resume while the Options panel is open — the player
            // must dismiss settings and click RESUME (user gesture) to re-lock.
            if (locked && prev === 'paused' && !settingsOpenRef.current) return 'playing';
            // A scripted run (?input=script:) never holds pointer lock — #486 A.
            // Neither does a touch player: their unlock is not a pause (#486 C).
            if (
              !locked &&
              prev === 'playing' &&
              !isScriptedInputMode() &&
              useInputStore.getState().activeSourceId !== 'touch'
            ) {
              return 'paused';
            }
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
    // Touch has no pointer to lock (iOS has no Pointer Lock at all): the start
    // button works on a plain tap.
    if (window.location.search.includes('no-pointer-lock') || isScriptedInputMode() || isTouchInputMode()) return;
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
    (
      mapId: MapRegistryId = selectedMapId,
      options?: {
        launchHour?: number;
        placedCacheIds?: string[];
        loadoutId?: string;
        journeyMode?: 'single' | 'journey';
      },
    ) => {
      handleSelectMap(mapId);
      initRunSession({
        mapId,
        launchHour: options?.launchHour,
        placedCacheIds: options?.placedCacheIds,
        loadoutId: options?.loadoutId,
        journeyMode: options?.journeyMode ?? 'single',
      });
      setActiveLaunchHour(options?.launchHour ?? getLaunchHour());
      setPhase('playing');
      if (isTouchInputMode()) void import('./input/handheld').then((m) => m.tryLockLandscape());
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
        if (!bootReady) return;
        e.preventDefault();
        handleStart(selectedMapId, { launchHour: undefined, placedCacheIds: [] });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bootReady, handleStart, phase, selectedMapId]);

  // No WebGL2 by any attempt: render static DOM and mount nothing. R3F, Rapier's
  // WASM world, the treadmill, and audio all assume a renderer exists, and
  // starting them anyway is what produced the infinite loader.
  if (graphicsCapability.tier === 'unsupported') {
    return (
      <ErrorBoundary>
        <GraphicsUnsupported
          statusMessage={graphicsCapability.statusMessage}
          attributesRejected={graphicsCapability.reason === 'attributes-rejected'}
        />
      </ErrorBoundary>
    );
  }

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
            key={canvasKey}
            dpr={canvasDprRange(rendererContextOptions.dprMax)}
            gl={async (props) => {
              // No retry, no fallback ladder: the envelope in
              // `rendererContextOptions` is the one the boot probe already proved
              // this machine will grant, attribute for attribute. A throw here is
              // a genuine failure — record *why* for the next boot, then let it
              // reach the ErrorBoundary.
              try {
                return await createGameRenderer(
                  {
                    ...props,
                    preserveDrawingBuffer: isVisualCaptureMode(),
                  },
                  {
                    preference: rendererPreference,
                    antialias: rendererContextOptions.antialias,
                    powerPreference: rendererContextOptions.powerPreference,
                    contextOptions: rendererContextOptions,
                    materialBackend,
                  }
                );
              } catch (error) {
                recordBootFailure('renderer-throw');
                throw error;
              }
            }}
            camera={{ position: [0, 10, -10], fov: 75 }}
            shadows={shadowModeToCanvasProp(rendererContextOptions.shadowMode)}
            frameloop={isScriptedInputMode() ? 'never' : 'always'}
            onCreated={({ gl }) => {
              debug.runStage('visualization', () => undefined);
              setCanvasReady(true);
              // Intentional Canvas remounts (quality key change, renderer swap)
              // dispose the old context and fire `webglcontextlost` without a
              // matching restore on the new element. Clear the toast whenever a
              // fresh renderer comes up successfully.
              setWebglRecovering(false);
              // Previous canvas's handlers go first: a remount must not hear the
              // old context's teardown as a fresh loss.
              detachGpuLoss.current?.();
              detachGpuLoss.current = attachGpuLossHandlers(gl, {
                onLost(kind, detail) {
                  setWebglRecovering(true);
                  // If the tab is reloaded before the GPU comes back, the next
                  // boot should know this was a GPU loss, not a slow start.
                  recordBootFailure(kind);
                  console.warn(
                    kind === 'device-lost'
                      ? `[App] WebGPU device lost${detail ? ` (${detail})` : ''} — remounting Canvas`
                      : '[App] WebGL context lost — waiting for restore',
                  );
                },
                onRestored(kind) {
                  if (kind === 'context-lost') console.info('[App] WebGL context restored — remounting Canvas');
                  setWebglRecovering(false);
                  setCanvasEpoch((epoch) => epoch + 1);
                },
              });
              if (isGpuLossDebugEnabled()) {
                (window as Window & { __watershedLoseGpu?: () => string | null }).__watershedLoseGpu = () =>
                  simulateGpuLoss(gl);
              }
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
                launchHour={activeLaunchHour}
              />
            </React.Suspense>
          </Canvas>

          {/* Touch layer (#486 C): only while the run is live. Unmounting it on pause releases every finger. */}
          {touchMode && phase === 'playing' && worldEnabled && (
            <React.Suspense fallback={null}>
              <TouchControls />
            </React.Suspense>
          )}
          {touchMode && phase === 'playing' && <div className="landscape-hint" role="note">Rotate to landscape for the best view</div>}

          {webglRecovering && (
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
          {!cleanTest && !isVisualCaptureMode() && graphicsCapability.tier === 'degraded' && (
            <SafeGraphicsBadge
              reason={graphicsCapability.reason}
              statusMessage={graphicsCapability.statusMessage}
              bootFailure={previousFailure?.reason ?? null}
            />
          )}

          {/* Asset loading overlay */}
          {debug.isStageEnabled('uiOverlay') && !skipLoader && (
            <Loader gamePhase={phase} canvasReady={canvasReady} worldEnabled={worldEnabled} />
          )}

          {/* Goal 4: Start Menu — shown before first run */}
          {debug.isStageEnabled('uiOverlay') && phase === 'menu' && !settingsOpen && (
            <StartMenu
              onStart={handleStart}
              selectedMapId={selectedMapId}
              onSelectMap={handleSelectMap}
              onOpenOptions={() => setSettingsOpen(true)}
              bootReady={bootReady}
            />
          )}
          {/* Goal 4: Pause Menu — shown when pointer lock is lost during play */}
          {debug.isStageEnabled('uiOverlay') && phase === 'paused' && !settingsOpen && (
            <React.Suspense fallback={null}>
              <PauseMenu
                onResume={handleResume}
                onRestart={handleRestart}
                onQuit={handleQuit}
                onOpenOptions={() => setSettingsOpen(true)}
              />
            </React.Suspense>
          )}
          {/* Options — reachable from StartMenu and PauseMenu. Rendered in the
              unlocked (menu/paused) state so key/mouse capture never fights
              pointer lock. Closing returns to the parent menu; from the pause
              menu that lands on RESUME, which re-locks on the user's click. */}
          {debug.isStageEnabled('uiOverlay') && settingsOpen && (phase === 'menu' || phase === 'paused') && (
            <div className="settings-panel-overlay">
              <React.Suspense fallback={null}>
                <SettingsPanel onClose={() => setSettingsOpen(false)} />
              </React.Suspense>
            </div>
          )}
          {sweDebug && (
            <React.Suspense fallback={null}>
              <SWEBedDebugOverlay />
            </React.Suspense>
          )}
          {debug.debugEnabled && !cleanTest && (
            <React.Suspense fallback={null}>
              <DebugPanel
                debug={debug}
                physicsDebug={physicsDebug}
                onTogglePhysicsDebug={setPhysicsDebug}
                rendererPreference={rendererPreference}
                onRendererPreferenceChange={handleRendererPreferenceChange}
                materialBackend={materialBackend}
                onMaterialBackendChange={handleMaterialBackendChange}
                wireframeDebug={wireframeDebug}
                onToggleWireframeDebug={setWireframeDebug}
                onEnableCleanTest={() => {
                  setCleanTestMode(true);
                  setCleanTestActive(true);
                  setPhysicsDebug(false);
                  setWireframeDebug(false);
                }}
              />
            </React.Suspense>
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
