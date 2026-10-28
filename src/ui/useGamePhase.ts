/**
 * useGamePhase.ts — menu → playing → paused, and everything that moves the
 * game between them, split out of App (#521 C1).
 *
 * Owns the phase, the deferred world mount, the Options panel, the selected map
 * and launch hour, the run-start path (`handleStart`), the one PAUSE consumer,
 * pointer-lock pause/resume, and Enter-to-start. `MenuShell` renders the
 * overlays from what this returns.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DebugStageController } from '../debug/debugStages';
import { initPersistence, hydrateStoreForRun } from '../systems/persistence/persistenceBootstrap';
import { rehydrateSettings } from '../systems/settings/useSettingsStore';
import { getActiveRunKey, getActiveMapId, setVehicleChoice } from '../utils/runContext';
import { useGameStore } from '../systems/GameState';
import type { MapRegistryId } from '../maps/registry';
import { setActiveUserRiver, type UserRiver } from '../systems/map/userRiverSession';
import { syncMapUrl } from '../maps/campaign';
import { setLastMapId, getLaunchHour } from '../systems/persistence/PersistenceSystem';
import { initRunSession, type RunConditions } from '../systems/journey/runSession';
import { resolveInitialVehicle } from '../experience/hooks/useInnerExperience';
import { prefetchRaftVehicle } from '../vehicles/raftVehicleChunk';
import { isScriptedInputMode } from '../input/scriptedRun';
import { onPauseRequest } from '../input/pauseBus';
import { useInputStore } from '../input/InputHub';
import { isTouchInputMode } from '../input/touchMode';
import { stopHaptics } from '../input/haptics';
import { queryFlags } from '../config/queryFlags';

/** Game phase determines which overlays are visible */
export type GamePhase = 'menu' | 'playing' | 'paused';

export interface StartOptions {
  launchHour?: number;
  placedCacheIds?: string[];
  loadoutId?: string;
  journeyMode?: 'single' | 'journey';
  conditions?: Partial<RunConditions>;
  vehicle?: 'runner' | 'raft' | null;
  userRiver?: UserRiver;
}

export type StartRun = (mapId?: MapRegistryId, options?: StartOptions) => void;

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

export function useGamePhase(debug: DebugStageController, bootReady: boolean) {
  const [phase, setPhase] = useState<GamePhase>('menu');
  /** Heavy Physics/track mount — deferred after Start so the menu can unmount first. */
  const [worldEnabled, setWorldEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(settingsOpen);
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);
  const [selectedMapId, setSelectedMapId] = useState<MapRegistryId>(() => getActiveMapId());
  // The raft is its own chunk: a map that starts on it fetches it while the menu is up.
  useEffect(() => {
    if (resolveInitialVehicle(selectedMapId) === 'raft') prefetchRaftVehicle();
  }, [selectedMapId]);
  const [activeLaunchHour, setActiveLaunchHour] = useState(() => getLaunchHour());

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
    void import('../input/handheld').then((m) => {
      if (!cancelled) dispose = m.applyHandheldEnvelope();
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [touchMode]);

  // Menu pick and the in-run map change (Experience's onMapChange) alike.
  const handleSelectMap = useCallback((mapId: MapRegistryId) => {
    setSelectedMapId(mapId);
    syncMapUrl(mapId);
    setLastMapId(mapId);
    hydrateStoreForRun(getActiveRunKey(mapId));
  }, []);

  useEffect(() => {
    useGameStore.getState().setIsPaused(phase === 'paused' || phase === 'menu');
  }, [phase]);

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
    if (queryFlags().noPointerLock || isScriptedInputMode() || isTouchInputMode()) return;
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

  const handleStart = useCallback<StartRun>(
    (mapId = selectedMapId, options) => {
      // Before the run key is read: a player's river keys its own bests.
      setActiveUserRiver(options?.userRiver ?? null);
      // Absent (Enter, Daily River, replay) keeps the menu's pick for this map.
      if (options?.vehicle !== undefined) setVehicleChoice(mapId, options.vehicle);
      handleSelectMap(mapId);
      initRunSession({
        mapId,
        launchHour: options?.launchHour,
        conditions: options?.conditions,
        placedCacheIds: options?.placedCacheIds,
        loadoutId: options?.loadoutId,
        journeyMode: options?.journeyMode ?? 'single',
      });
      // The run key depends on the new session (a Daily River keys by date),
      // so the store's bests hydrate again now that it exists.
      hydrateStoreForRun(getActiveRunKey(mapId));
      setActiveLaunchHour(options?.launchHour ?? getLaunchHour());
      setPhase('playing');
      if (isTouchInputMode()) void import('../input/handheld').then((m) => m.tryLockLandscape());
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

  return {
    phase,
    worldEnabled,
    settingsOpen,
    setSettingsOpen,
    selectedMapId,
    activeLaunchHour,
    handleSelectMap,
    handleStart,
    handleResume,
    handleQuit,
    handleReturnToMenu,
  };
}

export type GamePhaseState = ReturnType<typeof useGamePhase>;
