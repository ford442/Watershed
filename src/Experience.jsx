import { PointerLockControls, KeyboardControls, Html, Stats } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { BackSide } from "three";
import EnhancedSky from "./components/EnhancedSky";
import FlowForecast from "./components/FlowForecast";
import ForecastHUD from "./components/ForecastHUD";
import GameHUD from "./components/GameHUD";
import { WATER_LEVEL, PLAYER_SPAWN, PHYSICS } from "./constants/game";

// Vehicle system
import RunnerVehicle from "./vehicles/RunnerVehicle";
import RaftVehicle from "./vehicles/RaftVehicle";

// Level loading
import LevelLoader, { ErrorDisplay, LoadingDisplay } from "./systems/LevelLoader";
import ReachManager from "./systems/ReachManager";
import TrackManager from "./components/TrackManager";
import {
  DELTA_RAPIDS_CONTINUED_PROGRESSION,
  DELTA_RAPIDS_CONTINUED_START_INDEX,
  GLACIER_START_INDEX,
  MEANDER_TO_WATERFALL_PROGRESSION,
} from "./maps/meander_to_waterfall";

// NEW: Visual enhancement systems
import { BiomeProvider, BiomeTransition, BiomeDetector, useBiomeMaterials, useBiome } from "./systems/BiomeSystem";
import { LODProvider, PerformanceMonitor, useLOD } from "./systems/LODManager";
import { SplashSystem } from "./systems/SplashSystem";
import WaterReflection from "./components/WaterReflection";
import WaterInteraction from "./components/WaterInteraction";
import { PostProcessingPipeline } from "./components/PostProcessingPipeline";
import { useCameraShake } from "./hooks/useCameraShake";
import { useSegmentAudio } from "./hooks/useSegmentAudio";
import { initAudio, getAudioManager } from "./systems/AudioSystem";
import { SunPositionProvider, useSunPosition } from "./systems/SunPositionSystem";
import AudioDiagnosticsOverlay from "./components/AudioDiagnosticsOverlay";
import PhysicsDebugOverlay from "./components/PhysicsDebugOverlay";
import { DEBUG_STAGES } from "./debug/debugStages";
import PerfCheckpointMonitor from "./debug/PerfCheckpointMonitor";
import RendererDiagnosticsMonitor from "./rendering/RendererDiagnosticsMonitor";
import WireframeDebug from "./rendering/WireframeDebug";
import { tickScoreSystem, awardDodgeBonus, awardWaterfallBonus, resetScoreSystemState } from "./systems/ScoreSystem";
import { resetRunSession } from "./utils/resetRunSession";

// Goal 1: Zustand game state
import { useGameStore, batchFrameUpdate } from "./systems/GameState";
import { useChunkLoader } from "./hooks/useChunkLoader";

const DAM_RELEASE_SCHEDULE = [
  { hour: 6, release: 0.08 },
  { hour: 14, release: 0.12 },
];

const DEFAULT_MAPS = {
  meander: {
    id: 'meander',
    label: 'Map 1: Meander to Waterfall',
    startIndex: GLACIER_START_INDEX,
    progression: MEANDER_TO_WATERFALL_PROGRESSION,
    initialBiome: 'canyonSummer',
  },
  delta: {
    id: 'delta',
    label: 'Map 2: Delta Rapids Stub',
    startIndex: DELTA_RAPIDS_CONTINUED_START_INDEX,
    progression: DELTA_RAPIDS_CONTINUED_PROGRESSION,
    initialBiome: 'delta',
  },
};

// Base lighting configuration (keyed by canonical BiomePalette id)
const BIOME_LIGHTING = {
  canyonSummer: {
    ambientIntensity: 0.40,
    hemiSky: '#9ad0f0',
    hemiGround: '#3a3828',
    hemiIntensity: 0.85,
    dirColor: '#fff4e0',
    dirIntensity: 1.4,
    dirPosition: [12, 35, 18],
    fillColor: '#a0c4e8',
    fillIntensity: 0.22,
  },
  canyonAutumn: {
    ambientIntensity: 0.32,
    hemiSky: '#e8c070',
    hemiGround: '#382818',
    hemiIntensity: 0.65,
    dirColor: '#ffa040',
    dirIntensity: 1.1,
    dirPosition: [30, 22, 12],
    fillColor: '#ffc888',
    fillIntensity: 0.18,
  },
};

const NOOP_DEBUG = {
  debugEnabled: false,
  stageConfig: DEBUG_STAGES,
  enabledStages: Object.keys(DEBUG_STAGES).reduce((acc, key) => ({ ...acc, [key]: true }), {}),
  stageRuntime: {},
  isStageEnabled: () => true,
  setStageEnabled: () => {},
  runStage: async (_stageId, stageFn) => stageFn(),
  setStageLoading: () => {},
  setStageSuccess: () => {},
  setStageFailure: () => {},
};

function HeadlessSkySphere() {
  const { camera, scene } = useThree();
  const meshRef = useRef(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('no-pointer-lock')) {
      scene.fog = null;
    }
  }, [scene]);
  useFrame(() => {
    if (meshRef.current && camera) {
      meshRef.current.position.copy(camera.position);
    }
  });
  return (
    <mesh ref={meshRef} scale={[200, 200, 200]}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshBasicMaterial color="#1a4a8a" side={BackSide} />
    </mesh>
  );
}

/**
 * InnerExperience - The actual game scene
 * Wrapped in providers for context access
 */
const InnerExperience = ({ debug = NOOP_DEBUG, physicsDebug = false, wireframeDebug = false, cleanTest = false }) => {
  const [vehicleType, setVehicleTypeLocal] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('vehicle') === 'raft' ? 'raft' : 'runner';
  });
  const [noPointerLock] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.location.search.includes('no-pointer-lock');
  });
  const vehicleRef = useRef(null);
  const trackManagerRef = useRef(null);
  const { camera } = useThree();

  // Check for debug flag in URL for physics visualization
  const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug=true');
  const physicsDebugEnabled = !cleanTest && debug.debugEnabled && physicsDebug && debug.isStageEnabled('physicsDebug');

  // Goal 1: Zustand game state selectors
  const biome = useGameStore((s) => s.currentBiome);
  const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
  const isWipeout = useGameStore((s) => s.isWipeout);
  const isJourneyComplete = useGameStore((s) => s.isJourneyComplete);
  const setIsWipeout = useGameStore((s) => s.setIsWipeout);
  const setCurrentSegmentIndex = useGameStore((s) => s.setCurrentSegmentIndex);
  const setRespawnSegmentIndex = useGameStore((s) => s.setRespawnSegmentIndex);
  const setWaterfallGravityMultiplier = useGameStore((s) => s.setWaterfallGravityMultiplier);
  const setDistanceTraveled = useGameStore((s) => s.setDistanceTraveled);
  const setSpawnPoint = useGameStore((s) => s.setSpawnPoint);
  const spawnPoints = useGameStore((s) => s.spawnPoints);
  const respawnSegmentIndex = useGameStore((s) => s.respawnSegmentIndex);
  const setVehicleTypeStore = useGameStore((s) => s.setVehicleType);

  // Keep Zustand vehicleType in sync with local state so HUD/vignette can gate on it
  const setVehicleType = (type) => {
    setVehicleTypeLocal(type);
    setVehicleTypeStore(type);
  };

  // Runtime guard: catch non-finite transforms early before they propagate to
  // audio/reflection subsystems. Also exposes a lightweight camera snapshot for
  // the screenshot harness diagnostics.
  useFrame(() => {
    const pos = vehicleRef.current?.translation();
    if (pos && (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z))) {
      console.error('[NaNGuard] vehicle translation non-finite', pos);
    }
    const camPos = camera.position;
    const camFinite = Number.isFinite(camPos?.x) && Number.isFinite(camPos?.y) && Number.isFinite(camPos?.z);
    if (!camFinite) {
      console.error('[NaNGuard] camera position non-finite', camPos);
      return;
    }
    if (camera.matrixWorld.elements.some((v) => !Number.isFinite(v))) {
      console.error('[NaNGuard] camera matrixWorld non-finite', camera.matrixWorld.elements);
    }
    if (typeof window !== 'undefined') {
      window.__watershedCameraDiag = {
        uuid: camera.uuid,
        pos: { x: camPos.x, y: camPos.y, z: camPos.z },
        quat: { x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w },
        matrixWorld: Array.from(camera.matrixWorld.elements),
      };
    }
  });

  useEffect(() => {
    setVehicleTypeStore(vehicleType);
  }, [setVehicleTypeStore, vehicleType]);

  // BiomeProvider is the single authoritative source of biome state.
  // Calling setBiomeContext normalizes legacy IDs, triggers smooth palette
  // interpolation, and mirrors the canonical id to the Zustand store.
  const { setBiome: setBiomeContext, snapBiome: snapBiomeContext } = useBiome();
  const { sunWorldPosition } = useSunPosition();

  // Initialize Three.js audio listener on camera
  useEffect(() => {
    debug.runStage('audio', () => {
      initAudio(camera);
    });
  }, [camera, debug.runStage]);

  // Level loading state
  const [levelUrl, setLevelUrl] = useState(null);
  const [levelLoadError, setLevelLoadError] = useState(null);
  const [isLoadingLevel, setIsLoadingLevel] = useState(false);
  const [loadedLevelState, setLoadedLevelState] = useState(null);
  const [forecastSamples, setForecastSamples] = useState([]);
  const [reachId, setReachId] = useState(null);
  const [reachLoading, setReachLoading] = useState(false);
  const [reachError, setReachError] = useState(null);
  const [reachRetryKey, setReachRetryKey] = useState(0);
  const [defaultMapRunKey, setDefaultMapRunKey] = useState(0);
  const [activeDefaultMapId, setActiveDefaultMapId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('map') === 'delta' ? 'delta' : 'meander';
  });
  const [journeyDefaultAction] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('loop') === '1') return 'loop';
    return params.get('nextMap') === 'delta' ? 'nextMap' : 'loop';
  });
  const activeDefaultMap = DEFAULT_MAPS[activeDefaultMapId] ?? DEFAULT_MAPS.meander;
  const canContinueDefaultMap = activeDefaultMapId === 'meander';

  useEffect(() => {
    if (levelUrl || reachId) return;
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
    activeDefaultMap.initialBiome,
    activeDefaultMap.startIndex,
    levelUrl,
    reachId,
    snapBiomeContext,
    setCurrentSegmentIndex,
    setRespawnSegmentIndex,
  ]);

  // Get LOD config and quality level
  const { config: lodConfig, quality } = useLOD();

  // Get biome materials config
  const biomeMaterials = useBiomeMaterials();

  // Camera shake system
  const cameraShake = useCameraShake();

  // Velocity tracking for speed-based effects (E3) — use ref to avoid per-frame re-renders
  const playerVelocityRef = useRef(0);

  // Goal 3: Segment-aware ambient audio
  useSegmentAudio(currentSegmentIndex);

  const awardedWaterfallSegmentsRef = useRef(new Set());

  useEffect(() => {
    resetScoreSystemState();
  }, []);

  // Track segment enter events for respawn bookkeeping
  useEffect(() => {
    if (!debug.isStageEnabled('stateManagement')) return;
    try {
      debug.setStageLoading('stateManagement');
      const handleSegmentEnter = (e) => {
        const index = e.detail?.segmentIndex ?? 0;
        setCurrentSegmentIndex(index);
        setRespawnSegmentIndex(index);

        // Prefer per-segment gravityMultiplier from level data (JSON-loaded levels).
        // Fall back to hardcoded values for procedurally-generated segments that
        // don't carry an explicit physics.gravityMultiplier.
        if (e.detail?.gravityMultiplier !== undefined) {
          setWaterfallGravityMultiplier(e.detail.gravityMultiplier);
        } else if (index === 14) {
          // Waterfall gravity shift (procedural / default map)
          setWaterfallGravityMultiplier(1.45);
        } else if (index === 15) {
          // Reset gravity after waterfall
          setWaterfallGravityMultiplier(1.0);
        } else if (index >= 23 && index <= 29) {
          // Steep rapids: boost gravity for high-verticalBias sections
          setWaterfallGravityMultiplier(1.2);
        } else if (index === 30) {
          // Reset gravity after steep rapids
          setWaterfallGravityMultiplier(1.0);
        }

        if ((index === 15 || index === 30) && !awardedWaterfallSegmentsRef.current.has(index)) {
          awardedWaterfallSegmentsRef.current.add(index);
          awardWaterfallBonus();
        }

        // Audio cues for the downhill-creek → waterfall progression (segments 23–30)
        const audio = getAudioManager();
        if (audio) {
          if (index >= 23 && index <= 27) {
            audio.setAmbient('ambient_water', 1500);
          } else if (index === 28) {
            audio.playSound('rapids_roar', 0.8);
            audio.playSound('water_crash', 0.3);
          } else if (index === 29) {
            audio.playSound('water_crash', 1.0);
            window.dispatchEvent(new CustomEvent('camera-shake', { detail: { intensity: 0.7 } }));
          } else if (index === 30) {
            audio.setAmbient('ambient_water', 1500);
          }
        }
      };

      const handleSegmentSpawn = (e) => {
        const { segmentIndex, spawnPoint } = e.detail ?? {};
        if (segmentIndex !== undefined && spawnPoint) {
          setSpawnPoint(segmentIndex, spawnPoint);
        }
      };

      window.addEventListener('segment-enter', handleSegmentEnter);
      window.addEventListener('segment-spawn', handleSegmentSpawn);
      debug.setStageSuccess('stateManagement');
      return () => {
        window.removeEventListener('segment-enter', handleSegmentEnter);
        window.removeEventListener('segment-spawn', handleSegmentSpawn);
      };
    } catch (error) {
      debug.setStageFailure('stateManagement', error);
    }
  }, [
    debug.isStageEnabled,
    debug.setStageFailure,
    debug.setStageLoading,
    debug.setStageSuccess,
    setCurrentSegmentIndex,
    setRespawnSegmentIndex,
    setWaterfallGravityMultiplier,
    setSpawnPoint
  ]);

  useEffect(() => {
    const handleNearMiss = () => {
      const game = useGameStore.getState();
      if (!game.isWipeout) {
        awardDodgeBonus();
      }
    };

    window.addEventListener('player-near-miss', handleNearMiss);
    return () => window.removeEventListener('player-near-miss', handleNearMiss);
  }, []);

  // Goal 5: Performance regression tracking
  const slowFrameCount = useRef(0);
  const warnedSlowFrames = useRef(false);

  // Update camera shake and track velocity each frame
  useFrame((state, delta) => {
    if (!debug.isStageEnabled('stateManagement')) return;
    try {
      cameraShake.update(delta);

    // Goal 5: Warn if frame time exceeds 16.67ms (60 FPS) consistently
    if (delta > 0.025) { // > 25ms = < 40 FPS
      slowFrameCount.current += 1;
      if (slowFrameCount.current > 60 && !warnedSlowFrames.current) {
        warnedSlowFrames.current = true;
        console.warn(
          `[Experience] Sustained slow frames detected: ${Math.round(delta * 1000)}ms ` +
          `(${Math.round(1 / delta)} FPS). Target is <17ms (60 FPS).`
        );
      }
    } else {
      slowFrameCount.current = Math.max(0, slowFrameCount.current - 1);
    }

      if (vehicleRef.current) {
        const vel = vehicleRef.current.linvel?.();
        const pos = vehicleRef.current.translation?.();

      // Guard against NaN from Rapier during physics init — NaN here
      // propagates into Zustand, PostProcessingPipeline uniforms, and HUD.
      const velOk = vel && isFinite(vel.x) && isFinite(vel.z);
      const posOk = pos && isFinite(pos.x) && isFinite(pos.y) && isFinite(pos.z);

        if (velOk) {
          const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
          playerVelocityRef.current = speed;
          tickScoreSystem(delta, speed);

        const downstream = posOk ? Math.abs(pos.z) : 0;
        const meters = Math.floor(downstream * 0.5);
        batchFrameUpdate(
          { x: posOk ? pos.x : 0, y: posOk ? pos.y : 0, z: posOk ? pos.z : 0 },
          speed,
          useGameStore.getState().currentSegmentIndex
        );
        setDistanceTraveled(meters);
      }

      // Minimal wipeout detection
        if (posOk && pos.y < -80 && !isWipeout) {
          setIsWipeout(true);
        }
      }
    } catch (error) {
      debug.setStageFailure('stateManagement', error);
    }
  });

  // Check for level URL parameter on mount
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
  }, [debug.runStage]);

  useEffect(() => {
    if (!debug.isStageEnabled('dataProcessing')) return;
    if (isLoadingLevel || reachLoading) {
      debug.setStageLoading('dataProcessing');
    } else {
      debug.setStageSuccess('dataProcessing');
    }
  }, [debug.isStageEnabled, debug.setStageLoading, debug.setStageSuccess, isLoadingLevel, reachLoading]);

  useEffect(() => {
    if (!debug.isStageEnabled('reachStreaming')) return;
    if (reachLoading) {
      debug.setStageLoading('reachStreaming');
    } else if (reachError) {
      debug.setStageFailure('reachStreaming', reachError);
    } else {
      debug.setStageSuccess('reachStreaming');
    }
  }, [debug.isStageEnabled, debug.setStageFailure, debug.setStageLoading, debug.setStageSuccess, reachError, reachLoading]);

  // Handle level load
  const handleLevelLoad = useCallback((levelState) => {
    debug.runStage('dataProcessing', () => {
      setLoadedLevelState(levelState);
      setIsLoadingLevel(false);

      if (levelState?.biome?.baseType) {
        // normalizeBiomeId (inside getBiomePalette via setBiomeContext) converts
        // authored names like 'creek-summer' to canonical 'canyonSummer'.
        setBiomeContext(levelState.biome.baseType);
      }
    });
  }, [debug.runStage, setBiomeContext]);

  // Goal 3: Biome transition with segment-aware duration
  const handleBiomeChange = useCallback((newBiome, segmentIndex) => {
    // Summer → autumn at segment 15 uses 2000ms lerp (LEVEL_DESIGN.md)
    const isTransitionSegment = segmentIndex === 15;
    const duration = isTransitionSegment ? 2.0 : undefined;
    setBiomeContext(newBiome, duration);
  }, [setBiomeContext]);

  const handleLevelError = useCallback((error) => {
    debug.setStageFailure('dataProcessing', error);
    setLevelLoadError(error);
    setIsLoadingLevel(false);
  }, [debug.setStageFailure]);

  const handleRespawn = useCallback(() => {
    try {
      setIsWipeout(false);
      if (vehicleRef.current) {
        // Segment-aware respawn: use stored spawn point if available
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
        awardedWaterfallSegmentsRef.current.clear();
        resetScoreSystemState();
      }
    } catch (error) {
      debug.setStageFailure('stateManagement', error);
    }
  }, [debug.setStageFailure, setIsWipeout, spawnPoints, respawnSegmentIndex]);

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
  }, []);

  // Screenshot harness: ?screenshot=1 exposes teleport helpers for automated WebGL captures.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('screenshot=1')) {
      return undefined;
    }

    const api = {
      teleportToZ: (z, y = PLAYER_SPAWN.position[1]) => {
        if (!vehicleRef.current) return false;
        vehicleRef.current.setTranslation({ x: 0, y, z }, true);
        vehicleRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        vehicleRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
        return true;
      },
      teleportToSegment: (segmentIndex) => {
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

        // Mirror the store state that real treadmill progression would have set.
        setCurrentSegmentIndex(targetIndex);
        setRespawnSegmentIndex(targetIndex);

        // Replay segment-enter side effects incrementally so downstream flow,
        // biome, audio and journey-complete state is warm.
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
  }, [spawnPoints, currentSegmentIndex, activeDefaultMap, setCurrentSegmentIndex, setRespawnSegmentIndex]);

  const resetDefaultMapRun = useCallback((targetMapId) => {
    const targetMap = DEFAULT_MAPS[targetMapId] ?? DEFAULT_MAPS.meander;

    try {
      useGameStore.getState().resetGameState();
      setIsWipeout(false);
      setActiveDefaultMapId(targetMap.id);
      setCurrentSegmentIndex(targetMap.startIndex);
      setRespawnSegmentIndex(targetMap.startIndex);
      setWaterfallGravityMultiplier(1.0);
      snapBiomeContext(targetMap.initialBiome);
      useGameStore.setState({ currentBiome: targetMap.initialBiome, isPaused: false });
      setForecastSamples([]);
      awardedWaterfallSegmentsRef.current.clear();
      resetScoreSystemState();
      resetRunSession({
        biome: targetMap.initialBiome,
        flowSpeed: targetMap.id === 'meander' ? 2.2 : 0.25,
        segmentIndex: targetMap.startIndex,
      });
      teleportVehicleToStart();

      // Remount the default treadmill so active chunks, spawn points, and
      // journey-complete detection restart from the glacier prelude.
      if (!levelUrl && !reachId) {
        setDefaultMapRunKey((key) => key + 1);
      }
    } catch (error) {
      debug.setStageFailure('stateManagement', error);
    }
  }, [
    debug.setStageFailure,
    levelUrl,
    reachId,
    setCurrentSegmentIndex,
    setIsWipeout,
    setRespawnSegmentIndex,
    setWaterfallGravityMultiplier,
    snapBiomeContext,
    teleportVehicleToStart,
  ]);

  const handleLoopCurrentMap = useCallback(() => {
    resetDefaultMapRun(activeDefaultMapId);
  }, [activeDefaultMapId, resetDefaultMapRun]);

  const handleContinueJourney = useCallback(() => {
    resetDefaultMapRun('delta');
  }, [resetDefaultMapRun]);

  const handleDefaultJourneyAction = useCallback(() => {
    if (journeyDefaultAction === 'nextMap' && canContinueDefaultMap) {
      resetDefaultMapRun('delta');
      return;
    }
    resetDefaultMapRun(activeDefaultMapId);
  }, [activeDefaultMapId, canContinueDefaultMap, journeyDefaultAction, resetDefaultMapRun]);

  // Use lighting from biome system or fallback
  const L = BIOME_LIGHTING[biome] || BIOME_LIGHTING.canyonSummer;
  const isTightCanyon = currentSegmentIndex >= 20 && currentSegmentIndex <= 22;
  const waterfallFxIntensity =
    currentSegmentIndex === 13 ? 0.45 :
    currentSegmentIndex === 14 ? 1.0 :
    currentSegmentIndex === 15 ? 0.55 :
    currentSegmentIndex === 28 ? 0.6 :
    currentSegmentIndex === 29 ? 1.0 :
    currentSegmentIndex === 30 ? 0.45 : 0;
  const isSlotCanyonLighting = biome === 'slotCanyon' || isTightCanyon;
  const ambientIntensity = isSlotCanyonLighting ? Math.min(L.ambientIntensity, 0.18) : L.ambientIntensity;
  const hemiIntensity = isSlotCanyonLighting ? Math.min(L.hemiIntensity, 0.25) : L.hemiIntensity;
  const hemiSkyColor = isSlotCanyonLighting ? '#1a120a' : L.hemiSky;
  const hemiGroundColor = isSlotCanyonLighting ? '#0a0806' : L.hemiGround;
  const sharedSunPosition = useMemo(
    () => [sunWorldPosition.x, sunWorldPosition.y, sunWorldPosition.z],
    [sunWorldPosition.x, sunWorldPosition.y, sunWorldPosition.z]
  );

  useEffect(() => {
    const trackedStages = ['physics', 'visualization', 'worldSystems', 'postProcessing', 'uiOverlay'];
    trackedStages.forEach((stageId) => {
      if (debug.isStageEnabled(stageId)) {
        debug.setStageSuccess(stageId);
      }
    });
  }, [debug.isStageEnabled, debug.setStageSuccess]);

  const lastWaterfallRumbleRef = useRef(-1);
  useFrame(() => {
    const speed = playerVelocityRef.current;
    const rumble =
      currentSegmentIndex === 13 ? 0.05 + Math.min(0.08, speed * 0.002) :
      currentSegmentIndex === 14 ? 0.16 + Math.min(0.16, speed * 0.004) :
      currentSegmentIndex === 15 ? 0.06 :
      currentSegmentIndex === 28 ? 0.08 + Math.min(0.1, speed * 0.003) :
      currentSegmentIndex === 29 ? 0.18 + Math.min(0.18, speed * 0.004) :
      currentSegmentIndex === 30 ? 0.06 : 0;

    if (Math.abs(rumble - lastWaterfallRumbleRef.current) > 0.01) {
      lastWaterfallRumbleRef.current = rumble;
      window.dispatchEvent(new CustomEvent('camera-rumble', { detail: { intensity: rumble } }));
    }
  });

  // Speed-scaled shake intensity — read at segment-entry time
  const entrySpeedRef = useRef(0);
  useEffect(() => {
    entrySpeedRef.current = playerVelocityRef.current;
  }, [currentSegmentIndex]);

  useEffect(() => {
    const speed = entrySpeedRef.current;
    if (currentSegmentIndex === 13) {
      window.dispatchEvent(new CustomEvent('camera-shake', { detail: { intensity: 0.22, duration: 2.2, frequency: 14, angular: 0.012 } }));
    } else if (currentSegmentIndex === 14) {
      // Primary waterfall drop — scale punch with entry speed
      const speedBonus = Math.min(0.45, speed * 0.022);
      window.dispatchEvent(new CustomEvent('camera-shake', { detail: { intensity: 0.75 + speedBonus, duration: 2.8, frequency: 8, angular: 0.04 } }));
      window.dispatchEvent(new CustomEvent('boost-triggered', { detail: { intensity: 1.1, duration: 1.0 } }));
    } else if (currentSegmentIndex === 15) {
      window.dispatchEvent(new CustomEvent('camera-shake', { detail: { intensity: 0.28, duration: 1.4, frequency: 16, angular: 0.008 } }));
    } else if (currentSegmentIndex === 29) {
      // Second waterfall drop (canyon rapids section)
      const speedBonus = Math.min(0.5, speed * 0.025);
      window.dispatchEvent(new CustomEvent('camera-shake', { detail: { intensity: 0.8 + speedBonus, duration: 3.0, frequency: 8, angular: 0.045 } }));
      window.dispatchEvent(new CustomEvent('boost-triggered', { detail: { intensity: 1.2, duration: 1.2 } }));
    }
  }, [currentSegmentIndex]);

  return (
    <>
      {noPointerLock && <HeadlessSkySphere />}

      {/* Sky and environment */}
      {debug.isStageEnabled('visualization') && (
        <EnhancedSky />
      )}

      {/* Lighting - biome responsive */}
      {debug.isStageEnabled('visualization') && (
        <>
          <ambientLight intensity={ambientIntensity} />
          <hemisphereLight
            skyColor={hemiSkyColor}
            groundColor={hemiGroundColor}
            intensity={hemiIntensity}
          />
          <directionalLight
            color={L.dirColor}
            position={sharedSunPosition}
            intensity={L.dirIntensity}
            castShadow
            shadow-mapSize={[lodConfig.shadowMapSize, lodConfig.shadowMapSize]}
            shadow-bias={lodConfig.shadowBias}
            shadow-normalBias={lodConfig.shadowNormalBias}
            shadow-camera-near={1}
            shadow-camera-far={200}
            shadow-camera-left={-60}
            shadow-camera-right={60}
            shadow-camera-top={60}
            shadow-camera-bottom={-60}
          />
          <directionalLight
            color={L.fillColor}
            position={[-10, 15, -20]}
            intensity={L.fillIntensity}
          />
        </>
      )}

      {/* Water reflections (if enabled) */}
      {debug.isStageEnabled('worldSystems') && lodConfig.enableReflections && (
        <WaterReflection
          waterLevel={WATER_LEVEL}
          resolution={1024}
          updateInterval={2}
        />
      )}

      {/* Physics world */}
      {debug.isStageEnabled('physics') && (
        <Physics debug={isDebug || physicsDebugEnabled} gravity={[0, PHYSICS.GRAVITY, 0]}>
          {!noPointerLock && (
            <PointerLockControls
              makeDefault
              lockOnClick
              onLock={() => { }}
            />
          )}

          {/* Vehicle */}
          {vehicleType === 'runner' ? (
            <RunnerVehicle ref={vehicleRef} />
          ) : (
            <RaftVehicle ref={vehicleRef} />
          )}

          {physicsDebugEnabled && (
            <PhysicsDebugOverlay enabled={physicsDebugEnabled} vehicleRef={vehicleRef} />
          )}
          {wireframeDebug && !cleanTest && <WireframeDebug enabled={wireframeDebug} />}

          {/* Splash system for water interactions */}
          {debug.isStageEnabled('worldSystems') && (
            <SplashSystem
              playerRef={vehicleRef}
              waterLevel={WATER_LEVEL}
              waterWidth={12}
              flowSpeed={biomeMaterials.water.flowSpeed}
            />
          )}

          {/* Enhanced water interaction effects */}
          {debug.isStageEnabled('worldSystems') && (
            <WaterInteraction
              target={vehicleRef}
              isRaft={vehicleType === 'raft'}
              waterLevel={WATER_LEVEL}
              maxVelocity={15}
            />
          )}

          <FlowForecast
            temperature={8}
            snowpackIndex={0.65}
            damReleaseSchedule={DAM_RELEASE_SCHEDULE}
            onForecastChange={setForecastSamples}
          />

          {/* Track Generation */}
          {debug.isStageEnabled('dataProcessing') && (levelUrl ? (
            <LevelLoader
              levelUrl={levelUrl}
              onLoad={handleLevelLoad}
              onError={handleLevelError}
              showLoader={false}
              showError={false}
              raftRef={vehicleRef}
              onBiomeChange={handleBiomeChange}
              forecastSamples={forecastSamples}
            />
          ) : reachId ? (
            <ReachManager
              playerRef={vehicleRef}
              onBiomeChange={handleBiomeChange}
              forecastSamples={forecastSamples}
              reachId={reachId}
              onLoadingChange={setReachLoading}
              onError={setReachError}
              retryKey={reachRetryKey}
            />
          ) : (
            // Default to procedural TrackManager if no levelUrl or reachId
            <TrackManager
              ref={trackManagerRef}
              key={defaultMapRunKey}
              onBiomeChange={handleBiomeChange}
              raftRef={vehicleRef}
              forecastSamples={forecastSamples}
              startIndex={activeDefaultMap.startIndex}
              mapProgression={activeDefaultMap.progression}
            />
          ))}
        </Physics>
      )}

      {/* Post-processing effects - Bloom, Vignette, SSAO, Speed Effects */}
      {debug.isStageEnabled('postProcessing') && quality !== 'minimal' && (
        <PostProcessingPipeline
          quality={quality}
          vehicleRef={vehicleRef}
          isTightCanyon={isTightCanyon}
          waterfallIntensity={waterfallFxIntensity}
        />
      )}

      {/* --- DOM UI overlays: must be wrapped in <Html> inside R3F Canvas --- */}
      {debug.isStageEnabled('uiOverlay') && (
        <Html fullscreen zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
        {!cleanTest && <ForecastHUD samples={forecastSamples} />}

        <div style={{ pointerEvents: isWipeout || isJourneyComplete ? 'auto' : 'none' }}>
          <GameHUD
            isWipeout={isWipeout}
            onRespawn={handleRespawn}
            onRestartJourney={handleDefaultJourneyAction}
            onLoopMap={handleLoopCurrentMap}
            onContinueJourney={canContinueDefaultMap ? handleContinueJourney : undefined}
            mapLabel={activeDefaultMap.label}
          />
        </div>

        {/* Loading overlay */}
        {isLoadingLevel && (
          <LoadingDisplay message="Loading custom level..." />
        )}

        {/* Reach loading overlay */}
        {reachLoading && (
          <LoadingDisplay message="Loading Reach..." />
        )}

        {/* Error overlay */}
        {levelLoadError && (
          <div style={{ pointerEvents: 'auto' }}>
            <ErrorDisplay
              error={levelLoadError}
              onDismiss={() => setLevelLoadError(null)}
              onRetry={() => {
                setLevelLoadError(null);
                setIsLoadingLevel(true);
                setLoadedLevelState(null);
              }}
            />
          </div>
        )}

        {/* DEV-only audio diagnostics overlay — hidden in clean test / screenshot mode */}
        {import.meta.env.DEV && !cleanTest && <AudioDiagnosticsOverlay />}

        {/* Reach error toast — non-blocking because we fall back to procedural */}
        {reachError && (
          <div style={{
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(40, 40, 40, 0.9)',
            color: '#ffcc00',
            padding: '10px 18px',
            borderRadius: '6px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '14px',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            pointerEvents: 'auto',
          }}>
            <span>⚠ Reach unavailable — playing procedural track</span>
            <button
              onClick={() => {
                setReachError(null);
                setReachRetryKey((k) => k + 1);
              }}
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                color: '#fff',
                padding: '4px 10px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Retry
            </button>
            <button
              onClick={() => setReachError(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#aaa',
                cursor: 'pointer',
                fontSize: '16px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )}
        </Html>
      )}
      {/* ------------------------------------------------------------------ */}
    </>
  );
};

/**
 * Experience Component
 *
 * Wraps the game in provider contexts for biome and LOD management
 */
const Experience = ({ debug = NOOP_DEBUG, physicsDebug = false, rendererPreference = 'webgpu', wireframeDebug = false, cleanTest = false }) => {
  // Check for debug flag in URL
  const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug=true');
  
  return (
    <>
      {isDebug && <Stats />}
      <KeyboardControls
      map={[
        { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
        { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
        { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
        { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
        { name: 'jump', keys: ['Space'] },
        { name: 'sprint', keys: ['ShiftLeft', 'ShiftRight'] },
        { name: 'brake', keys: ['ControlLeft', 'ControlRight'] },
        { name: 'dodge', keys: ['AltLeft', 'AltRight'] },
      ]}
    >
      <LODProvider initialQuality="high" enableAdaptive={true} targetFPS={60}>
        <BiomeProvider initialBiome="canyonSummer" enableTimeOfDay={false}>
          <SunPositionProvider>
            <BiomeTransition />
            <InnerExperience debug={debug} physicsDebug={physicsDebug} wireframeDebug={wireframeDebug} cleanTest={cleanTest} />
            <PerformanceMonitor visible={import.meta.env.DEV} />
            <RendererDiagnosticsMonitor preference={rendererPreference} />
            {debug.debugEnabled && <PerfCheckpointMonitor />}
          </SunPositionProvider>
        </BiomeProvider>
      </LODProvider>
    </KeyboardControls>
    </>
  );
};

export default Experience;
