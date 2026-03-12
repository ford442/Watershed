import { PointerLockControls, KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import TrackManager from "./components/TrackManager";
import EnhancedSky from "./components/EnhancedSky";

// Vehicle system
import RunnerVehicle from "./vehicles/RunnerVehicle";
import RaftVehicle from "./vehicles/RaftVehicle";

// Level loading
import LevelLoader, { ErrorDisplay, LoadingDisplay } from "./systems/LevelLoader";

// NEW: Visual enhancement systems
import { BiomeProvider, BiomeTransition, BiomeDetector, useBiomeMaterials } from "./systems/BiomeSystem";
import { LODProvider, PerformanceMonitor } from "./systems/LODManager";
import { SplashSystem } from "./systems/SplashSystem";
import WaterReflection from "./components/WaterReflection";
import WaterInteraction from "./components/WaterInteraction";
import { PostProcessingEffects } from "./components/PostProcessingEffects";
import { useCameraShake } from "./hooks/useCameraShake";

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

/**
 * InnerExperience - The actual game scene
 * Wrapped in providers for context access
 */
const InnerExperience = () => {
  const [biome, setBiome] = useState('summer');
  const [vehicleType, setVehicleType] = useState('runner');
  const vehicleRef = useRef(null);
  
  // Level loading state
  const [levelUrl, setLevelUrl] = useState(null);
  const [levelLoadError, setLevelLoadError] = useState(null);
  const [isLoadingLevel, setIsLoadingLevel] = useState(false);
  const [loadedLevelState, setLoadedLevelState] = useState(null);
  
  // Get LOD config and quality level
  const { config: lodConfig, quality } = useLOD();
  
  // Get biome materials config
  const biomeMaterials = useBiomeMaterials();
  
  // Camera shake system
  const cameraShake = useCameraShake();
  
  // Velocity tracking for speed-based effects (E3)
  const [playerVelocity, setPlayerVelocity] = useState(0);
  
  // Update camera shake and track velocity each frame
  useFrame((state, delta) => {
    cameraShake.update(delta);
    
    // Track player velocity for post-processing effects
    if (vehicleRef.current) {
      const vel = vehicleRef.current.linvel?.();
      if (vel) {
        const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        setPlayerVelocity(speed);
      }
    }
  });
  
  // Check for level URL parameter on mount
  useEffect(() => {
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
  }, []);
  
  // Handle level load
  const handleLevelLoad = useCallback((levelState) => {
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
  }, []);
  
  const handleLevelError = useCallback((error) => {
    setLevelLoadError(error);
    setIsLoadingLevel(false);
  }, []);

  // Use lighting from biome system or fallback
  const L = BIOME_LIGHTING[biome] || BIOME_LIGHTING.summer;

  return (
    <>
      {/* Sky and environment */}
      <EnhancedSky biome={biome} />
      
      {/* Lighting - biome responsive */}
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
      
      {/* Water reflections (if enabled) */}
      {lodConfig.enableReflections && (
        <WaterReflection 
          waterLevel={0.5}
          resolution={1024}
          updateInterval={2}
        />
      )}
      
      {/* Physics world */}
      <Physics gravity={[0, -20, 0]}>
        <PointerLockControls 
          makeDefault 
          lockOnClick
          onLock={() => {}} 
        />
        
        {/* Vehicle */}
        {vehicleType === 'runner' ? (
          <RunnerVehicle ref={vehicleRef} />
        ) : (
          <RaftVehicle ref={vehicleRef} />
        )}
        
        {/* Splash system for water interactions */}
        <SplashSystem 
          playerRef={vehicleRef}
          waterLevel={0.5}
          waterWidth={12}
          flowSpeed={biomeMaterials.water.flowSpeed}
        />
        
        {/* Enhanced water interaction effects */}
        <WaterInteraction 
          target={vehicleRef}
          isRaft={vehicleType === 'raft'}
          waterLevel={0.5}
          maxVelocity={15}
        />
        
        {/* Track Generation */}
        {levelUrl ? (
          <LevelLoader
            levelUrl={levelUrl}
            onLoad={handleLevelLoad}
            onError={handleLevelError}
            showLoader={false}
            raftRef={vehicleRef}
            onBiomeChange={setBiome}
          />
        ) : (
          <TrackManager onBiomeChange={setBiome} raftRef={vehicleRef} />
        )}
      </Physics>
      
      {/* Post-processing effects - Bloom, Vignette, SSAO, Speed Effects */}
      <PostProcessingEffects 
        quality={quality}
        velocity={playerVelocity}
        maxVelocity={25}
      />
      
      {/* Loading overlay */}
      {isLoadingLevel && (
        <LoadingDisplay message="Loading custom level..." />
      )}
      
      {/* Error overlay */}
      {levelLoadError && (
        <ErrorDisplay 
          error={levelLoadError}
          onDismiss={() => setLevelLoadError(null)}
          onRetry={() => {
            setLevelLoadError(null);
            setIsLoadingLevel(true);
            setLoadedLevelState(null);
          }}
        />
      )}
    </>
  );
};

/**
 * Experience Component
 * 
 * Wraps the game in provider contexts for biome and LOD management
 */
const Experience = () => {
  return (
    <KeyboardControls
      map={[
        { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
        { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
        { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
        { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
        { name: 'jump', keys: ['Space'] },
      ]}
    >
      <LODProvider initialQuality="high" enableAdaptive={true} targetFPS={60}>
        <BiomeProvider initialBiome="canyonSummer" enableTimeOfDay={false}>
          <BiomeTransition />
          <InnerExperience />
          <PerformanceMonitor visible={process.env.NODE_ENV === 'development'} />
        </BiomeProvider>
      </LODProvider>
    </KeyboardControls>
  );
};

export default Experience;
