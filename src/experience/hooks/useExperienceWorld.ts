import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { FlowForecastSample } from '../../components/FlowForecast';
import { PLAYER_SPAWN } from '../../constants/game';
import { useBiome } from '../../systems/BiomeSystem';
import { normalizeBiomeId } from '../../configs/biomes';
import { commitJourneyScore, resetScoreSystemState } from '../../systems/score/ScoreSystem';
import { useGameStore } from '../../systems/GameState';
import { resetRunSession } from '../../utils/resetRunSession';
import type { TrackManagerRef } from '../../components/TrackManager';
import type { MapRegistryId } from '../../maps/registry';
import {
  getJourneyCompletionDecision,
  parseUrlMapId,
  resolveMapId,
  syncMapUrl,
} from '../../maps/campaign';
import type { DebugStageController } from '../../debug/debugStages';
import { DAM_RELEASE_SCHEDULE, DEFAULT_MAPS } from '../constants';
import type { VehicleRigidBodyRef } from '../types';
import {
  getGhostBestScoreForMap,
  getLastMapId,
  markMapCompleted,
  setLastMapId,
} from '../../systems/persistence/PersistenceSystem';
import { hydrateStoreForRun } from '../../systems/persistence/persistenceBootstrap';
import { getActiveRunKey } from '../../utils/runContext';
import { ACTIVE_MAP_ID } from '../../maps/registry';
import { buildForecastSamples } from '../../systems/map/flowForecast';
import {
  initRunSession,
  getActiveLaunchHour,
  getRunSession,
  isJourneyMode,
  advanceRunSessionMap,
  saveJourneyCheckpoint,
} from '../../systems/journey/runSession';
import { getLaunchHour } from '../../systems/persistence/PersistenceSystem';
import { kickoffMapHandoff } from '../../systems/journey/journeyHandoff';
import { planMapHandoff } from '../../systems/journey/journeyContinuity';

const DEFAULT_FORECAST_OPTIONS = {
  temperature: 8,
  snowpackIndex: 0.65,
  damReleaseSchedule: DAM_RELEASE_SCHEDULE,
  horizonHours: 24,
} as const;

function buildDefaultForecastSamples(launchHour: number): FlowForecastSample[] {
  return buildForecastSamples({
    ...DEFAULT_FORECAST_OPTIONS,
    startHour: launchHour,
  });
}

function forecastSamplesEqual(
  a: ReadonlyArray<FlowForecastSample>,
  b: ReadonlyArray<FlowForecastSample>,
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].hour !== b[i].hour || a[i].flowRate !== b[i].flowRate || a[i].state !== b[i].state) {
      return false;
    }
  }
  return true;
}

interface UseExperienceWorldOptions {
  debug: DebugStageController;
  vehicleRef: RefObject<VehicleRigidBodyRef | null>;
  trackManagerRef: RefObject<TrackManagerRef | null>;
  awardedWaterfallSegmentsRef: RefObject<Set<number>>;
  /** Controlled map id from App / StartMenu (URL parity). */
  mapId?: MapRegistryId;
  onMapChange?: (mapId: MapRegistryId) => void;
  onReturnToMenu?: () => void;
  launchHour?: number;
}

function resolveInitialMapId(controlled?: MapRegistryId): MapRegistryId {
  return resolveMapId({
    selection: controlled ?? null,
    urlMap: parseUrlMapId(),
    lastPlayed: getLastMapId() ?? null,
    fallback: ACTIVE_MAP_ID,
  });
}

export function useExperienceWorld({
  debug,
  vehicleRef,
  trackManagerRef,
  awardedWaterfallSegmentsRef,
  mapId: controlledMapId,
  onMapChange,
  onReturnToMenu,
  launchHour: controlledLaunchHour,
}: UseExperienceWorldOptions) {
  const launchHour = controlledLaunchHour ?? getActiveLaunchHour() ?? getLaunchHour();
  const { setBiome: setBiomeContext, snapBiome: snapBiomeContext } = useBiome();

  const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
  const isJourneyComplete = useGameStore((s) => s.isJourneyComplete);
  const setIsWipeout = useGameStore((s) => s.setIsWipeout);
  const setCurrentSegmentIndex = useGameStore((s) => s.setCurrentSegmentIndex);
  const setRespawnSegmentIndex = useGameStore((s) => s.setRespawnSegmentIndex);
  const setWaterfallGravityMultiplier = useGameStore((s) => s.setWaterfallGravityMultiplier);
  const spawnPoints = useGameStore((s) => s.spawnPoints);
  const respawnSegmentIndex = useGameStore((s) => s.respawnSegmentIndex);

  const [levelUrl, setLevelUrl] = useState<string | null>(null);
  const [levelLoadError, setLevelLoadError] = useState<Error | string | null>(null);
  const [isLoadingLevel, setIsLoadingLevel] = useState(false);
  const [loadedLevelState, setLoadedLevelState] = useState<unknown>(null);
  const [forecastSamples, setForecastSamples] = useState<FlowForecastSample[]>(
    () => buildDefaultForecastSamples(launchHour),
  );
  const [reachId, setReachId] = useState<string | null>(null);
  const [reachLoading, setReachLoading] = useState(false);
  const [reachError, setReachError] = useState<Error | string | null>(null);
  const [reachRetryKey, setReachRetryKey] = useState(0);
  const [defaultMapRunKey, setDefaultMapRunKey] = useState(0);
  const [activeDefaultMapId, setActiveDefaultMapId] = useState<MapRegistryId>(() =>
    resolveInitialMapId(controlledMapId),
  );
  /** Suppress remount / snap when App mapId updates from a seamless handoff. */
  const seamlessHandoffRef = useRef(false);

  const activeDefaultMap = DEFAULT_MAPS[activeDefaultMapId] ?? DEFAULT_MAPS.meander;
  const journeyModeActive = isJourneyMode();
  const journeyDecision = useMemo(
    () => getJourneyCompletionDecision(activeDefaultMapId),
    [activeDefaultMapId],
  );
  const canContinueDefaultMap = journeyDecision.kind === 'continue';
  const continueLabel =
    journeyDecision.kind === 'continue'
      ? `CONTINUE TO ${journeyDecision.nextLabel.toUpperCase()}`
      : undefined;
  const isFinalMap = journeyDecision.kind === 'summary';
  const ghostBestScore = useMemo(
    () => (isFinalMap ? getGhostBestScoreForMap(activeDefaultMapId) : 0),
    [activeDefaultMapId, isFinalMap, isJourneyComplete],
  );

  useEffect(() => {
    setForecastSamples(buildDefaultForecastSamples(launchHour));
  }, [launchHour]);

  // Keep local map state in sync when App / StartMenu changes selection.
  useEffect(() => {
    if (!controlledMapId || controlledMapId === activeDefaultMapId) return;

    if (seamlessHandoffRef.current) {
      // App URL sync after seamless handoff — adopt id without remount/snap.
      setActiveDefaultMapId(controlledMapId);
      seamlessHandoffRef.current = false;
      return;
    }

    const targetMap = DEFAULT_MAPS[controlledMapId] ?? DEFAULT_MAPS.meander;
    setActiveDefaultMapId(controlledMapId);
    setCurrentSegmentIndex(targetMap.startIndex);
    setRespawnSegmentIndex(targetMap.startIndex);
    snapBiomeContext(targetMap.initialBiome);
    useGameStore.setState({ currentBiome: targetMap.initialBiome });
    if (!levelUrl && !reachId) {
      setDefaultMapRunKey((key) => key + 1);
    }
  }, [
    activeDefaultMapId,
    controlledMapId,
    levelUrl,
    reachId,
    setCurrentSegmentIndex,
    setRespawnSegmentIndex,
    snapBiomeContext,
  ]);

  useEffect(() => {
    if (levelUrl || reachId) return;
    if (seamlessHandoffRef.current) return;

    // Only snap spawn/biome on hard map loads (TrackManager remount key), not
    // seamless handoffs that update activeDefaultMapId in place.
    const syncMapStartState = () => {
      setCurrentSegmentIndex(activeDefaultMap.startIndex);
      setRespawnSegmentIndex(activeDefaultMap.startIndex);
      snapBiomeContext(activeDefaultMap.initialBiome);
      useGameStore.setState({ currentBiome: activeDefaultMap.initialBiome });
    };

    syncMapStartState();
    const timeout = window.setTimeout(syncMapStartState, 0);
    return () => window.clearTimeout(timeout);
  }, [
    defaultMapRunKey,
    levelUrl,
    reachId,
    snapBiomeContext,
    setCurrentSegmentIndex,
    setRespawnSegmentIndex,
    // intentional: read latest map from closure when remount key changes
    activeDefaultMap.initialBiome,
    activeDefaultMap.startIndex,
  ]);

  useEffect(() => {
    debug.runStage('dataProcessing', () => {
      const params = new URLSearchParams(window.location.search);
      const levelParam = params.get('level');
      const levelUrlParam = params.get('levelUrl');
      const reachIdParam = params.get('reachId');

      if (levelParam) {
        setLevelUrl(`./levels/${levelParam}`);
        setIsLoadingLevel(true);
      } else if (levelUrlParam) {
        setLevelUrl(levelUrlParam);
        setIsLoadingLevel(true);
      } else if (reachIdParam) {
        setReachId(reachIdParam);
      }
    });
  }, [debug]);

  useEffect(() => {
    if (!debug.isStageEnabled('dataProcessing')) return;
    if (isLoadingLevel || reachLoading) {
      debug.setStageLoading('dataProcessing');
    } else {
      debug.setStageSuccess('dataProcessing');
    }
  }, [debug, isLoadingLevel, reachLoading]);

  useEffect(() => {
    if (!debug.isStageEnabled('reachStreaming')) return;
    if (reachLoading) {
      debug.setStageLoading('reachStreaming');
    } else if (reachError) {
      debug.setStageFailure('reachStreaming', reachError);
    } else {
      debug.setStageSuccess('reachStreaming');
    }
  }, [debug, reachError, reachLoading]);

  // Persist campaign progress once when a map journey completes.
  useEffect(() => {
    if (!isJourneyComplete) return;
    markMapCompleted(activeDefaultMapId);
    commitJourneyScore();
  }, [isJourneyComplete, activeDefaultMapId]);

  const handleLevelLoad = useCallback(
    (levelState: { biome?: { baseType?: string } } | null) => {
      debug.runStage('dataProcessing', () => {
        setLoadedLevelState(levelState);
        setIsLoadingLevel(false);

        if (levelState?.biome?.baseType) {
          setBiomeContext(normalizeBiomeId(levelState.biome.baseType));
        }
      });
    },
    [debug, setBiomeContext],
  );

  const handleBiomeChange = useCallback(
    (newBiome: string, segmentIndex?: number) => {
      const biomeId = normalizeBiomeId(newBiome);
      const isTransitionSegment = segmentIndex === 15 || segmentIndex === 17;
      const duration = isTransitionSegment ? 2.0 : undefined;
      setBiomeContext(biomeId, duration);

      const isGlacial = biomeId === 'glacialMelt' || biomeId === 'glacier';
      window.dispatchEvent(
        new CustomEvent('weather-update', {
          detail: {
            type: isGlacial ? 'snow' : 'clear',
            intensity: isGlacial ? 0.65 : 0,
            rippleStrength: 0,
          },
        }),
      );
    },
    [setBiomeContext],
  );

  const handleLevelError = useCallback(
    (error: Error | string) => {
      debug.setStageFailure('dataProcessing', error);
      setLevelLoadError(error);
      setIsLoadingLevel(false);
    },
    [debug],
  );

  const handleRespawn = useCallback(() => {
    try {
      setIsWipeout(false);
      if (vehicleRef.current) {
        const spawn = spawnPoints[respawnSegmentIndex];
        const fallback = {
          x: PLAYER_SPAWN.position[0],
          y: PLAYER_SPAWN.position[1],
          z: PLAYER_SPAWN.position[2],
        };
        const target = spawn ?? fallback;

        vehicleRef.current.setTranslation(target, true);
        vehicleRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        vehicleRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
        awardedWaterfallSegmentsRef.current?.clear();
        resetScoreSystemState();
      }
    } catch (error) {
      debug.setStageFailure('stateManagement', error);
    }
  }, [awardedWaterfallSegmentsRef, debug, respawnSegmentIndex, setIsWipeout, spawnPoints, vehicleRef]);

  const teleportVehicleToStart = useCallback(() => {
    if (!vehicleRef.current) return;

    const target = {
      x: PLAYER_SPAWN.position[0],
      y: PLAYER_SPAWN.position[1],
      z: PLAYER_SPAWN.position[2],
    };

    vehicleRef.current.setTranslation(target, true);
    vehicleRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
    vehicleRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }, [vehicleRef]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('screenshot=1')) {
      return undefined;
    }

    const api = {
      teleportToZ: (z: number, y: number = PLAYER_SPAWN.position[1] as number) => {
        if (!vehicleRef.current) return false;
        vehicleRef.current.setTranslation({ x: 0, y, z }, true);
        vehicleRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        vehicleRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
        return true;
      },
      teleportToSegment: (segmentIndex: number) => {
        if (!vehicleRef.current) return false;

        const spawn = spawnPoints[segmentIndex];
        const targetPosition = spawn
          ? { x: spawn.x, y: spawn.y + 1.5, z: spawn.z }
          : { x: 0, y: PLAYER_SPAWN.position[1], z: -segmentIndex * 95 };

        const previousIndex = currentSegmentIndex ?? activeDefaultMap.startIndex;
        const targetIndex = Math.max(0, Math.floor(segmentIndex));

        vehicleRef.current.setTranslation(targetPosition, true);
        vehicleRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        vehicleRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);

        setCurrentSegmentIndex(targetIndex);
        setRespawnSegmentIndex(targetIndex);

        if (trackManagerRef.current?.synthesizeSegmentEnter) {
          const startIdx = Math.max(previousIndex + 1, activeDefaultMap.startIndex);
          for (let i = startIdx; i <= targetIndex; i += 1) {
            trackManagerRef.current.synthesizeSegmentEnter(i);
          }
        }

        return true;
      },
      getSpawnPoints: () => ({ ...spawnPoints }),
    };

    window.__watershedScreenshot = api;
    return () => {
      delete window.__watershedScreenshot;
    };
  }, [
    activeDefaultMap,
    currentSegmentIndex,
    setCurrentSegmentIndex,
    setRespawnSegmentIndex,
    spawnPoints,
    trackManagerRef,
    vehicleRef,
  ]);

  const resetDefaultMapRun = useCallback(
    (targetMapId: MapRegistryId) => {
      const targetMap = DEFAULT_MAPS[targetMapId] ?? DEFAULT_MAPS.meander;

      try {
        syncMapUrl(targetMapId);
        setLastMapId(targetMapId);
        hydrateStoreForRun(getActiveRunKey(targetMapId));
        initRunSession({
          mapId: targetMapId,
          launchHour: getActiveLaunchHour(),
          placedCacheIds: getRunSession()?.placedCacheIds ?? [],
          loadoutId: getRunSession()?.loadoutId,
          journeyMode: getRunSession()?.journeyMode,
        });
        useGameStore.getState().resetGameState();
        setIsWipeout(false);
        setActiveDefaultMapId(targetMapId);
        onMapChange?.(targetMapId);
        setCurrentSegmentIndex(targetMap.startIndex);
        setRespawnSegmentIndex(targetMap.startIndex);
        setWaterfallGravityMultiplier(1.0);
        snapBiomeContext(targetMap.initialBiome);
        useGameStore.setState({ currentBiome: targetMap.initialBiome, isPaused: false });
        setForecastSamples(buildDefaultForecastSamples(launchHour));
        awardedWaterfallSegmentsRef.current?.clear();
        resetScoreSystemState();
        resetRunSession({
          biome: targetMap.initialBiome,
          flowSpeed: targetMap.id === 'meander' ? 2.2 : 0.25,
          segmentIndex: targetMap.startIndex,
        });
        teleportVehicleToStart();

        if (!levelUrl && !reachId) {
          setDefaultMapRunKey((key) => key + 1);
        }
      } catch (error) {
        debug.setStageFailure('stateManagement', error);
      }
    },
    [
      awardedWaterfallSegmentsRef,
      debug,
      levelUrl,
      onMapChange,
      reachId,
      setCurrentSegmentIndex,
      setIsWipeout,
      setRespawnSegmentIndex,
      setWaterfallGravityMultiplier,
      snapBiomeContext,
      teleportVehicleToStart,
    ],
  );

  /**
   * Seamless campaign handoff: no TrackManager remount, preserve vehicle
   * velocity + survival wetness/exposure, cross-fade biome, emit boundary events.
   */
  const performSeamlessMapHandoff = useCallback(
    (fromMapId: MapRegistryId, segmentIndex: number) => {
      const decision = getJourneyCompletionDecision(fromMapId);
      if (decision.kind !== 'continue') {
        // Final map — fall through to classic journey-complete overlay.
        if (!useGameStore.getState().isJourneyComplete) {
          useGameStore.getState().setJourneyComplete();
        }
        return false;
      }

      const nextMapId = decision.nextMapId;
      const plan =
        planMapHandoff({
          fromMapId,
          toMapId: nextMapId,
          lastSegmentIndex: segmentIndex,
        }) ?? null;

      if (!plan) return false;

      const kickoff = kickoffMapHandoff({
        fromMapId,
        toMapId: nextMapId,
        segmentIndex,
      });
      if (!kickoff) return false;

      const attached = trackManagerRef.current?.handoffToMap?.({
        nextMapId,
        plan: kickoff.plan,
      });
      if (!attached) {
        console.warn(
          `[useExperienceWorld] Seamless handoff attach failed for ${fromMapId} → ${nextMapId}; falling back to remount`,
        );
        resetDefaultMapRun(nextMapId);
        return false;
      }

      seamlessHandoffRef.current = true;

      const score = useGameStore.getState().score;
      advanceRunSessionMap(nextMapId, { score, segmentIndex: plan.nextMapStartIndex });
      saveJourneyCheckpoint({
        mapId: nextMapId,
        segmentIndex: plan.nextMapStartIndex,
        score,
      });

      // Cross-fade biome (no snap); keep Canvas + vehicle motion.
      setBiomeContext(kickoff.biomeKickoff.biomeId, kickoff.biomeKickoff.durationSeconds);
      useGameStore.getState().clearJourneyComplete();
      useGameStore.setState({
        currentBiome: kickoff.biomeKickoff.biomeId,
        isPaused: false,
      });

      setActiveDefaultMapId(nextMapId);
      syncMapUrl(nextMapId);
      onMapChange?.(nextMapId);

      // Do NOT teleport, reset score, or remount TrackManager.
      console.log(
        `[useExperienceWorld] Seamless map handoff ${fromMapId} → ${nextMapId} (segment ${segmentIndex})`,
      );
      return true;
    },
    [onMapChange, resetDefaultMapRun, setBiomeContext, trackManagerRef],
  );

  const handleSeamlessHandoffFromTrack = useCallback(
    (info: { segmentIndex: number; fromMapId: MapRegistryId }) => {
      performSeamlessMapHandoff(info.fromMapId, info.segmentIndex);
    },
    [performSeamlessMapHandoff],
  );

  const handleLoopCurrentMap = useCallback(() => {
    resetDefaultMapRun(activeDefaultMapId);
  }, [activeDefaultMapId, resetDefaultMapRun]);

  const handleContinueJourney = useCallback(() => {
    const decision = getJourneyCompletionDecision(activeDefaultMapId);
    if (decision.kind !== 'continue') return;

    // Prefer seamless handoff (no Canvas / TrackManager remount).
    const segmentIndex =
      useGameStore.getState().currentSegmentIndex ??
      DEFAULT_MAPS[activeDefaultMapId]?.startIndex ??
      0;
    const ok = performSeamlessMapHandoff(activeDefaultMapId, segmentIndex);
    if (!ok) {
      resetDefaultMapRun(decision.nextMapId);
    }
  }, [activeDefaultMapId, performSeamlessMapHandoff, resetDefaultMapRun]);

  const handleDefaultJourneyAction = useCallback(() => {
    const decision = getJourneyCompletionDecision(activeDefaultMapId);
    if (decision.kind === 'continue') {
      handleContinueJourney();
      return;
    }
    resetDefaultMapRun(activeDefaultMapId);
  }, [activeDefaultMapId, handleContinueJourney, resetDefaultMapRun]);

  const handleReturnToMenu = useCallback(() => {
    setLastMapId(activeDefaultMapId);
    useGameStore.getState().resetGameState();
    onReturnToMenu?.();
  }, [activeDefaultMapId, onReturnToMenu]);

  useEffect(() => {
    const trackedStages = ['physics', 'visualization', 'worldSystems', 'postProcessing', 'uiOverlay'] as const;
    trackedStages.forEach((stageId) => {
      if (debug.isStageEnabled(stageId)) {
        debug.setStageSuccess(stageId);
      }
    });
  }, [debug]);

  const stableSetForecastSamples = useCallback((samples: FlowForecastSample[]) => {
    setForecastSamples((prev) => (forecastSamplesEqual(prev, samples) ? prev : samples));
  }, []);

  return {
    levelUrl,
    levelLoadError,
    isLoadingLevel,
    forecastSamples,
    launchHour,
    reachId,
    reachLoading,
    reachError,
    reachRetryKey,
    defaultMapRunKey,
    activeDefaultMapId,
    activeDefaultMap,
    canContinueDefaultMap,
    continueLabel,
    isFinalMap,
    ghostBestScore,
    /** Journey mode auto-handoffs at boundaries; single-map still seamless on Continue. */
    seamlessJourney: journeyModeActive,
    handleSeamlessHandoffFromTrack,
    handleLevelLoad,
    handleBiomeChange,
    handleLevelError,
    handleRespawn,
    handleLoopCurrentMap,
    handleContinueJourney,
    handleDefaultJourneyAction,
    handleReturnToMenu,
    setForecastSamples: stableSetForecastSamples,
    setLevelLoadError,
    setIsLoadingLevel,
    setLoadedLevelState,
    setReachLoading,
    setReachError,
    setReachRetryKey,
    loadedLevelState,
  };
}