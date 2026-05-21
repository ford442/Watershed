import { PointerLockControls, KeyboardControls, Html, Stats } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import EnhancedSky from "./components/EnhancedSky";
import FlowForecast from "./components/FlowForecast";
import ForecastHUD from "./components/ForecastHUD";
import GameHUD from "./components/GameHUD";
import { WATER_LEVEL, PLAYER_SPAWN } from "./constants/game";

// Vehicle system
import RunnerVehicle from "./vehicles/RunnerVehicle";
import RaftVehicle from "./vehicles/RaftVehicle";

// Level loading
import LevelLoader, { ErrorDisplay, LoadingDisplay } from "./systems/LevelLoader";
import ReachManager from "./systems/ReachManager";
import TrackManager from "./components/TrackManager";

// NEW: Visual enhancement systems
import { BiomeProvider, BiomeTransition, BiomeDetector, useBiomeMaterials } from "./systems/BiomeSystem";
import { LODProvider, PerformanceMonitor, useLOD } from "./systems/LODManager";
import { SplashSystem } from "./systems/SplashSystem";
import WaterReflection from "./components/WaterReflection";
import WaterInteraction from "./components/WaterInteraction";
import { PostProcessingPipeline } from "./components/PostProcessingPipeline";
import { useCameraShake } from "./hooks/useCameraShake";
import { useSegmentAudio } from "./hooks/useSegmentAudio";
import { initAudio, getAudioManager } from "./systems/AudioSystem";
import AudioDiagnosticsOverlay from "./components/AudioDiagnosticsOverlay";
import { DEBUG_STAGES } from "./debug/debugStages";
import PerfCheckpointMonitor from "./debug/PerfCheckpointMonitor";

// Goal 1: Zustand game state
import { useGameStore, batchFrameUpdate } from "./systems/GameState";
import { useChunkLoader } from "./hooks/useChunkLoader";

const DAM_RELEASE_SCHEDULE = [
  { hour: 6, release: 0.08 },
  { hour: 14, release: 0.12 },
];

// Base lighting configuration
const BIOME_LIGHTING = {
  summer: {
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
  autumn: {
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

/**
 * InnerExperience - The actual game scene
 * Wrapped in providers for context access
 */
const InnerExperience = ({ debug = NOOP_DEBUG, physicsDebug = false }) => {
  const [vehicleType, setVehicleType] = useState('runner');
  const vehicleRef = useRef(null);
  const { camera } = useThree();

  // Check for debug flag in URL for physics visualization
  const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug=true');

  // Goal 1: Zustand game state selectors
  const biome = useGameStore((s) => s.currentBiome);
  const setBiome = useGameStore((s) => s.setCurrentBiome);
  const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
  const isWipeout = useGameStore((s) => s.isWipeout);
  const setIsWipeout = useGameStore((s) => s.setIsWipeout);
  const setCurrentSegmentIndex = useGameStore((s) => s.setCurrentSegmentIndex);
  const setRespawnSegmentIndex = useGameStore((s) => s.setRespawnSegmentIndex);
  const setWaterfallGravityMultiplier = useGameStore((s) => s.setWaterfallGravityMultiplier);
  const setCurrentSpeed = useGameStore((s) => s.setCurrentSpeed);
  const setDistanceTraveled = useGameStore((s) => s.setDistanceTraveled);
  const setSpawnPoint = useGameStore((s) => s.setSpawnPoint);
  const spawnPoints = useGameStore((s) => s.spawnPoints);
  const respawnSegmentIndex = useGameStore((s) => s.respawnSegmentIndex);

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
  const [reachLoading, setReachLoading] = useState(false);
  const [reachError, setReachError] = useState(null);
  const [reachRetryKey, setReachRetryKey] = useState(0);

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

  // Track segment enter events for respawn bookkeeping
  useEffect(() => {
    if (!debug.isStageEnabled('stateManagement')) return;
    try {
      debug.setStageLoading('stateManagement');
      const handleSegmentEnter = (e) => {
        const index = e.detail?.segmentIndex ?? 0;
        setCurrentSegmentIndex(index);
        setRespawnSegmentIndex(index);

        // Waterfall gravity shift for segment 14
        if (index === 14) {
          setWaterfallGravityMultiplier(1.45);
        } else if (index === 15) {
          // Reset gravity after waterfall
          setWaterfallGravityMultiplier(1.0);
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

        const downstream = posOk ? Math.abs(pos.z) : 0;
        const meters = Math.floor(downstream * 0.5);
        batchFrameUpdate(
          { x: posOk ? pos.x : 0, y: posOk ? pos.y : 0, z: posOk ? pos.z : 0 },
          speed,
          useGameStore.getState().currentSegmentIndex
        );
        setDistanceTraveled(meters);
        setCurrentSpeed(speed);
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

      if (levelParam) {
        setLevelUrl(`./levels/${levelParam}`);
        setIsLoadingLevel(true);
      } else if (levelUrlParam) {
        setLevelUrl(levelUrlParam);
        setIsLoadingLevel(true);
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
        const biomeMap = {
          'creek-summer': 'summer',
          'creek-autumn': 'autumn',
          'alpine-spring': 'summer',
          'canyon-sunset': 'autumn',
          'midnight-mist': 'autumn',
        };
        const newBiome = biomeMap[levelState.biome.baseType] || 'summer';
        setBiome(newBiome);
      }
    });
  }, [debug.runStage, setBiome]);

  // Goal 3: Biome transition with segment-aware duration
  const handleBiomeChange = useCallback((newBiome, segmentIndex) => {
    // Summer → autumn at segment 15 uses 2000ms lerp (LEVEL_DESIGN.md)
    const isTransitionSegment = segmentIndex === 15;
    const duration = isTransitionSegment ? 2.0 : undefined;
    setBiome(newBiome, duration);
  }, [setBiome]);

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
      }
    } catch (error) {
      debug.setStageFailure('stateManagement', error);
    }
  }, [debug.setStageFailure, setIsWipeout, spawnPoints, respawnSegmentIndex]);

  // Use lighting from biome system or fallback
  const L = BIOME_LIGHTING[biome] || BIOME_LIGHTING.summer;

  useEffect(() => {
    const trackedStages = ['physics', 'visualization', 'worldSystems', 'postProcessing', 'uiOverlay'];
    trackedStages.forEach((stageId) => {
      if (debug.isStageEnabled(stageId)) {
        debug.setStageSuccess(stageId);
      }
    });
  }, [debug.isStageEnabled, debug.setStageSuccess]);

  return (
    <>
      {/* Sky and environment */}
      {debug.isStageEnabled('visualization') && <EnhancedSky biome={biome} />}

      {/* Lighting - biome responsive */}
      {debug.isStageEnabled('visualization') && (
        <>
          <ambientLight intensity={L.ambientIntensity} />
          <hemisphereLight
            skyColor={L.hemiSky}
            groundColor={L.hemiGround}
            intensity={L.hemiIntensity}
          />
          <directionalLight
            color={L.dirColor}
            position={L.dirPosition}
            intensity={L.dirIntensity}
            castShadow
            shadow-mapSize={[lodConfig.shadowMapSize, lodConfig.shadowMapSize]}
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
        <Physics debug={isDebug} gravity={[0, -9.8, 0]}>
          <PointerLockControls
            makeDefault
            lockOnClick
            onLock={() => { }}
          />

          {/* Vehicle */}
          {vehicleType === 'runner' ? (
            <RunnerVehicle ref={vehicleRef} />
          ) : (
            <RaftVehicle ref={vehicleRef} />
          )}

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
              onBiomeChange={handleBiomeChange}
              raftRef={vehicleRef}
              forecastSamples={forecastSamples}
            />
          ))}
        </Physics>
      )}

      {/* Post-processing effects - Bloom, Vignette, SSAO, Speed Effects */}
      {debug.isStageEnabled('postProcessing') && quality !== 'minimal' && (
        <PostProcessingPipeline
          quality={quality}
          vehicleRef={vehicleRef}
        />
      )}

      {/* --- DOM UI overlays: must be wrapped in <Html> inside R3F Canvas --- */}
      {debug.isStageEnabled('uiOverlay') && (
        <Html fullscreen zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
        <ForecastHUD samples={forecastSamples} />

        <div style={{ pointerEvents: isWipeout ? 'auto' : 'none' }}>
          <GameHUD
            isWipeout={isWipeout}
            onRespawn={handleRespawn}
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

        {/* DEV-only audio diagnostics overlay */}
        {import.meta.env.DEV && <AudioDiagnosticsOverlay />}

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
const Experience = ({ debug = NOOP_DEBUG, physicsDebug = false }) => {
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
          <BiomeTransition />
          <InnerExperience debug={debug} physicsDebug={physicsDebug} />
          <PerformanceMonitor visible={import.meta.env.DEV} />
          {debug.debugEnabled && <PerfCheckpointMonitor />}
        </BiomeProvider>
      </LODProvider>
    </KeyboardControls>
    </>
  );
};

export default Experience;
